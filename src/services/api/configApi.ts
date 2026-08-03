import { AppConfigItem } from '../../types/config';
import { apiClient } from './apiClient';

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

  if (Array.isArray(record.items)) {
    return record.items;
  }

  if (Array.isArray(record.data)) {
    return record.data;
  }

  const dataRecord = record.data;
  if (dataRecord && typeof dataRecord === 'object' && !Array.isArray(dataRecord)) {
    const nested = dataRecord as Record<string, unknown>;
    if (Array.isArray(nested.items)) {
      return nested.items;
    }
  }

  return [];
}

export async function listAppConfigs(configTypes?: string[]): Promise<AppConfigItem[]> {
  const params = configTypes && configTypes.length > 0
    ? { configType: configTypes.join(',') }
    : undefined;

  const response = await apiClient.get<unknown>('/v1/config', { params });
  const items = extractArrayPayload(response.data);

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;

      const configType = normalizeString(row.configType);
      const configId = normalizeString(row.configId);
      if (!configType || !configId) return null;

      return {
        configType,
        configId,
        enabled: Boolean(row.enabled),
        config: row.config ?? {},
        description: normalizeString(row.description),
        version: typeof row.version === 'number' ? row.version : null,
        updatedAt: normalizeString(row.updatedAt),
        updatedBy: normalizeString(row.updatedBy),
      } as AppConfigItem;
    })
    .filter((item): item is AppConfigItem => item !== null);
}
