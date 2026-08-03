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
import { logger } from '../../utils/logger';

const TAG = 'ApiClient';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Runtime-settable API base URL. Initialised from env var, overridden by OrgConfig at startup. */
let _apiBaseUrl = process.env.EXPO_PUBLIC_TOUR_DATA_API_BASE_URL || '';

/**
 * Set the API base URL at runtime (called from App startup after loading OrgConfig).
 */
export function setApiBaseUrl(url: string): void {
  _apiBaseUrl = url.replace(/\/+$/, '');
  logger.info(TAG, `API base URL set to ${_apiBaseUrl}`);
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2_000;
const DEBUG_GET_REQUESTS = process.env.EXPO_PUBLIC_API_DEBUG_GET === 'true';

function shouldDebugMethod(method: RequestMethod): boolean {
  return method !== 'GET' || DEBUG_GET_REQUESTS;
}

function hasRequestBody(method: RequestMethod): boolean {
  return method === 'POST' || method === 'PUT';
}

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
  /**
   * Marks API errors that are expected and will be handled by the caller.
   * Expected errors are still thrown, but are not logged as warnings.
   */
  isExpectedError?: (error: ApiError) => boolean;
}

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

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
// Auth token provider — wired by AuthContext at app startup
// ---------------------------------------------------------------------------

/**
 * Returns the current JWT access token for API authentication.
 * Wired by AuthContext via setAuthTokenProvider() with Amplify Auth session token.
 */
let _getAuthToken: (() => Promise<string | null>) = async () => null;

/**
 * Register the auth token provider. Called by AuthContext on mount
 * to supply the Amplify Auth session token for all API requests.
 */
export const setAuthTokenProvider = (
  provider: () => Promise<string | null>,
): void => {
  _getAuthToken = provider;
};

/**
 * Callback invoked when the API receives a 401 that cannot be recovered
 * by refreshing the token. AuthContext registers this to force logout.
 */
let _onAuthInvalidated: (() => void) | null = null;

/**
 * Register a callback for unrecoverable 401 errors.
 * Called by AuthContext to redirect to the login screen.
 */
export const setAuthInvalidatedCallback = (
  callback: () => void,
): void => {
  _onAuthInvalidated = callback;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildUrl(path: string, params?: Record<string, string>): string {
  if (!_apiBaseUrl) {
    throw new ApiError(
      'API base URL is not configured. Set EXPO_PUBLIC_TOUR_DATA_API_BASE_URL in your .env file, or enable mock mode with EXPO_PUBLIC_USE_MOCK_DATA=true.',
      0,
      'CONFIG_ERROR',
    );
  }
  const base = _apiBaseUrl.replace(/\/+$/, '');
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function normalizePayloadKeysToCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePayloadKeysToCamelCase(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const camelKey = toCamelCaseKey(key);
    normalized[camelKey] = normalizePayloadKeysToCamelCase(nestedValue);
  }
  return normalized;
}

function isDevelopmentRuntime(): boolean {
  const maybeDev = (globalThis as { __DEV__?: unknown }).__DEV__;
  if (typeof maybeDev === 'boolean') {
    return maybeDev;
  }
  return process.env.NODE_ENV !== 'production';
}

/**
 * Determine whether an error represents a network connectivity failure.
 *
 * `fetch()` throws TypeError on network failures, but TypeErrors also arise
 * from data processing bugs (e.g. iterating a non-iterable).  We therefore
 * match against known network-failure messages to avoid mis-classification.
 */
const NETWORK_ERROR_PATTERNS = [
  'network request failed',   // React Native
  'failed to fetch',          // Chrome / Edge
  'load failed',              // Safari
  'networkerror',             // Generic
];

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return NETWORK_ERROR_PATTERNS.some((p) => msg.includes(p));
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
  method: RequestMethod,
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
    isExpectedError,
  } = options;

  const url = buildUrl(path, params);
  const headers = await buildHeaders(extraHeaders);
  const debugMethod = shouldDebugMethod(method);

  if (debugMethod) {
    logger.debug(TAG, `Request init ${method}`, {
      path,
      params,
      hasAuthHeader: Boolean(headers.Authorization),
      timeoutMs,
      maxRetries,
    });
  }

  if (debugMethod) {
    logger.debug(TAG, `${method} ${url}`);
  }

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

      if (body !== undefined && hasRequestBody(method)) {
        const normalizedBody = normalizePayloadKeysToCamelCase(body);
        if (debugMethod && isDevelopmentRuntime() && attempt === 0) {
          logger.debug(TAG, `${method} payload (normalized)`, {
            path,
            payload: normalizedBody,
          });
        }
        fetchOptions.body = JSON.stringify(normalizedBody);
      }

      if (debugMethod) {
        logger.debug(TAG, `Request attempt ${attempt + 1}/${maxRetries + 1}`, {
          method,
          path,
        });
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (debugMethod) {
        logger.debug(TAG, `Response ${response.status} (attempt ${attempt + 1})`, {
          method,
          path,
          ok: response.ok,
        });
      }

      // Handle 401 — attempt token refresh once
      if (response.status === 401 && attempt === 0) {
        // Token may have expired. Refresh and retry once.
        const newToken = await _getAuthToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          continue;
        }
        // Token refresh failed — session is invalid, notify AuthContext
        if (_onAuthInvalidated) {
          _onAuthInvalidated();
        }
      }

      // Parse response body
      const responseBody = await response.json().catch((e: unknown) => {
        logger.warn(TAG, 'Failed to parse response JSON', e);
        return null;
      });

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

      if (debugMethod) {
        logger.debug(TAG, `Request error (attempt ${attempt + 1})`, {
          method,
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (error instanceof ApiError && isExpectedError?.(error)) {
        logger.info(TAG, `Expected API error (attempt ${attempt + 1})`, {
          method,
          path,
          statusCode: error.statusCode,
          errorCode: error.errorCode,
          message: error.message,
        });
      } else {
        logger.warn(TAG, `Request error (attempt ${attempt + 1})`, error);
      }

      // If externally aborted, don't retry
      if (signal?.aborted) {
        throw error;
      }

      // Network errors are retryable
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (isNetworkError(error) || isAbortError) {
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
      if (debugMethod) {
        logger.debug(TAG, `Retry backoff ${backoffMs}ms`, {
          method,
          path,
          nextAttempt: attempt + 2,
        });
      }
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
