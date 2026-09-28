import { AppConfigItem } from '../../types/config';
import {
  LovConfig,
  RIDER_PROFILE_CONFIG_TYPES,
  RiderProfileAttributeConfig,
  RiderProfileConfigType,
  RiderProfileSectionConfig,
} from '../../types/riderProfile';
import { apiClient } from './apiClient';

export type RiderProfileConfigByType = {
  RIDER_PROFILE_SECTION: RiderProfileSectionConfig;
  RIDER_PROFILE_ATTRIBUTE: RiderProfileAttributeConfig;
  LOV: LovConfig;
};

type RiderProfileConfigApiItem<T> = AppConfigItem<T>;

function assertAllowedType(configType: RiderProfileConfigType): void {
  if (!RIDER_PROFILE_CONFIG_TYPES.includes(configType)) {
    throw new Error(`Unsupported rider profile config type: ${configType}`);
  }
}

function asConfigItems<T>(payload: unknown): RiderProfileConfigApiItem<T>[] {
  if (!Array.isArray(payload)) return [];
  const result: RiderProfileConfigApiItem<T>[] = [];

  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.configType !== 'string' || typeof row.configId !== 'string') continue;

    result.push({
      configType: row.configType,
      configId: row.configId,
      enabled: Boolean(row.enabled),
      config: (row.config ?? {}) as T,
      description: typeof row.description === 'string' ? row.description : null,
      version: typeof row.version === 'number' ? row.version : null,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
      updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : null,
    });
  }

  return result;
}

export async function listEnabledRiderProfileConfig<TType extends RiderProfileConfigType>(
  configType: TType,
): Promise<RiderProfileConfigApiItem<RiderProfileConfigByType[TType]>[]> {
  assertAllowedType(configType);
  const response = await apiClient.get<unknown>('/v1/config', {
    params: { configType },
  });

  const data = response.data;
  const items = Array.isArray(data)
    ? data
    : ((data as { items?: unknown[] } | null)?.items ?? []);

  return asConfigItems<RiderProfileConfigByType[TType]>(items);
}

export async function listAdminRiderProfileConfig<TType extends RiderProfileConfigType>(
  configType: TType,
): Promise<RiderProfileConfigApiItem<RiderProfileConfigByType[TType]>[]> {
  assertAllowedType(configType);
  const response = await apiClient.get<unknown>(`/v1/admin/config/${configType}`);
  const data = response.data;
  const items = Array.isArray(data)
    ? data
    : ((data as { items?: unknown[] } | null)?.items ?? []);

  return asConfigItems<RiderProfileConfigByType[TType]>(items);
}

export async function upsertRiderProfileConfig<TType extends RiderProfileConfigType>(
  configType: TType,
  configId: string,
  payload: {
    enabled: boolean;
    config: RiderProfileConfigByType[TType];
    version?: number | null;
  },
): Promise<RiderProfileConfigApiItem<RiderProfileConfigByType[TType]>> {
  assertAllowedType(configType);

  const response = await apiClient.put<RiderProfileConfigApiItem<RiderProfileConfigByType[TType]>>(
    `/v1/admin/config/${configType}/${encodeURIComponent(configId)}`,
    payload,
  );

  if (!response.data) {
    throw new Error('Rider profile config save returned an empty response.');
  }
  return response.data;
}
