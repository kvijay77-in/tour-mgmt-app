/**
 * Name directory API service.
 *
 * Provides lightweight lookup data for rider names and Cognito user names.
 */

import { apiClient } from './apiClient';

export interface RiderNameDirectoryEntry {
  riderId: string;
  name: string | null;
  personalCode?: string | null;
}

export interface CognitoUserNameEntry {
  sub: string;
  name: string | null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const keys = ['data', 'items', 'riders', 'users'];

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

/**
 * GET /v1/tours/{tourId}/riders/names
 */
export async function listTourRiderNames(tourId: string): Promise<RiderNameDirectoryEntry[]> {
  const response = await apiClient.get<unknown>(`/v1/tours/${tourId}/riders/names`);
  const items = extractArrayPayload(response.data);

  const parsed: RiderNameDirectoryEntry[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const riderId = normalizeString(row.riderId);
    if (!riderId) continue;

    const normalizedPersonalCode = normalizeString(row.personalCode);

    parsed.push({
      riderId,
      name: normalizeString(row.name),
      personalCode: normalizedPersonalCode ? normalizedPersonalCode.toUpperCase() : null,
    });
  }

  return parsed;
}

/**
 * GET /v1/users/cognito
 */
export async function listCognitoUserNames(): Promise<CognitoUserNameEntry[]> {
  const response = await apiClient.get<unknown>('/v1/users/cognito');
  const items = extractArrayPayload(response.data);

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const sub = normalizeString(row.sub);
      if (!sub) return null;
      return {
        sub,
        name: normalizeString(row.name),
      };
    })
    .filter((item): item is CognitoUserNameEntry => item !== null);
}
