/**
 * Base API client for tour-data-api backend communication.
 * 
 * Responsibilities:
 * - Base URL configuration from environment variables
 * - JWT token injection from Amplify Auth session
 * - Automatic token refresh on 401 responses
 * - Standardised error handling matching backend error format
 * - Request retry with exponential backoff (for network failures)
 * - Request/response logging (non-sensitive data only)
 * 
 * See docs/DataIntegrationDesign.md §2.3 for design details.
 */

import { ApiResponse } from '../../types/api';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE_URL = process.env.TOUR_DATA_API_BASE_URL || '';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestOptions {
  /** Query string parameters */
  params?: Record<string, string>;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Override default timeout (ms) */
  timeoutMs?: number;
  /** Override default max retries */
  maxRetries?: number;
}

/** Errors thrown by the API client */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Auth token provider (placeholder until Phase 4)
// ---------------------------------------------------------------------------

/**
 * Returns the current JWT access token for API authentication.
 * Phase 4 will replace this with Amplify Auth session token.
 */
let _getAuthToken: (() => Promise<string | null>) = async () => null;

/**
 * Register the auth token provider. Called during app initialisation
 * once Amplify Auth is configured (Phase 4).
 */
export const setAuthTokenProvider = (
  provider: () => Promise<string | null>,
): void => {
  _getAuthToken = provider;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildUrl(path: string, params?: Record<string, string>): string {
  const base = API_BASE_URL.replace(/\/+$/, '');
  const url = new URL(`${base}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }
  return url.toString();
}

async function buildHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };

  const token = await _getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

function isRetryable(status: number): boolean {
  // Retry on server errors and 429 (rate-limited)
  return status >= 500 || status === 429;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // fetch throws TypeError on network failures
    return true;
  }
  return false;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core request function with retry
// ---------------------------------------------------------------------------

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const {
    params,
    headers: extraHeaders,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = MAX_RETRIES,
  } = options;

  const url = buildUrl(path, params);
  const headers = await buildHeaders(extraHeaders);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Merge external signal with timeout signal
    const mergedSignal = signal
      ? combineSignals(signal, controller.signal)
      : controller.signal;

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: mergedSignal,
      };

      if (body !== undefined && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      // Handle 401 — attempt token refresh once
      if (response.status === 401 && attempt === 0) {
        // Token may have expired. Refresh and retry once.
        const newToken = await _getAuthToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          continue;
        }
      }

      // Parse response body
      const responseBody = await response.json().catch(() => null);

      // Success
      if (response.ok) {
        return responseBody as ApiResponse<T>;
      }

      // Non-retryable error
      if (!isRetryable(response.status)) {
        const apiResp = responseBody as ApiResponse<T> | null;
        throw new ApiError(
          apiResp?.error?.message || `HTTP ${response.status}`,
          response.status,
          apiResp?.error?.code,
          responseBody,
        );
      }

      // Retryable server error — will retry
      lastError = new ApiError(
        `HTTP ${response.status}`,
        response.status,
        (responseBody as ApiResponse<T>)?.error?.code,
        responseBody,
      );
    } catch (error) {
      clearTimeout(timeoutId);

      // If externally aborted, don't retry
      if (signal?.aborted) {
        throw error;
      }

      // Network errors are retryable
      if (isNetworkError(error) || (error instanceof DOMException && error.name === 'AbortError')) {
        lastError = error;
      } else if (error instanceof ApiError) {
        // Re-throw non-retryable ApiErrors
        if (!isRetryable(error.statusCode)) {
          throw error;
        }
        lastError = error;
      } else {
        throw error;
      }
    }

    // Exponential backoff before retry
    if (attempt < maxRetries) {
      const backoffMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      await delay(backoffMs);
    }
  }

  // All retries exhausted
  if (lastError instanceof ApiError) {
    throw lastError;
  }
  throw new ApiError(
    `Request failed after ${maxRetries + 1} attempts`,
    0,
    'NETWORK_ERROR',
  );
}

/**
 * Combine two AbortSignals — aborts when either fires.
 */
function combineSignals(
  ...signals: AbortSignal[]
): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(sig.reason), {
      once: true,
    });
  }
  return controller.signal;
}

// ---------------------------------------------------------------------------
// Public API client
// ---------------------------------------------------------------------------

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('GET', path, undefined, options);
  },

  post<T>(
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return request<T>('POST', path, body, options);
  },

  put<T>(
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return request<T>('PUT', path, body, options);
  },

  delete<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('DELETE', path, undefined, options);
  },
};
