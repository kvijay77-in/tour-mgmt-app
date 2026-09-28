import { CONFIG_TYPE } from '../../constants/idCodes';
import { AppConfigItem, IdCodeFormatConfig, IdCodeTypeConfig, IdCodeTypeName } from '../../types/config';
import { getDatabase, registerSessionMemoryReset, USE_SESSION_MEMORY, withWriteTransaction } from './database';

/** Web: session-only copy keyed by `configType|configId`. */
const memoryConfigs = new Map<string, AppConfigItem>();
registerSessionMemoryReset(() => memoryConfigs.clear());

function memoryItemsByType(configType: string, enabledOnly: boolean): AppConfigItem[] {
  return [...memoryConfigs.values()]
    .filter((item) => item.configType === configType && (!enabledOnly || item.enabled))
    .sort((a, b) => a.configId.localeCompare(b.configId));
}

function normalizeIdCodeTypeName(value: unknown): IdCodeTypeName | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (trimmed === 'RIDER' || trimmed === 'CYCLE' || trimmed === 'BAGGAGE') {
    return trimmed;
  }
  return null;
}

function mapRowToAppConfigItem(row: Record<string, unknown>): AppConfigItem {
  let parsedConfig: unknown = {};
  try {
    parsedConfig = JSON.parse((row.configJson as string) || '{}');
  } catch {
    parsedConfig = {};
  }

  return {
    configType: row.configType as string,
    configId: row.configId as string,
    enabled: (row.enabled as number) === 1,
    config: parsedConfig,
    version: typeof row.version === 'number' ? row.version : null,
    updatedAt: (row.updatedAt as string | null) ?? null,
  };
}

function toIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

function mapToIdCodeFormat(item: AppConfigItem): IdCodeFormatConfig | null {
  const cfg = item.config as Record<string, unknown>;
  if (!cfg || typeof cfg !== 'object') return null;
  const method = typeof cfg.method === 'string' ? cfg.method.toUpperCase() : null;

  if (method === 'SUBSTRING') {
    const idCode = cfg.idCode as Record<string, unknown> | undefined;
    const idCodeType = cfg.idCodeType as Record<string, unknown> | undefined;
    const personalCode = cfg.personalCode as Record<string, unknown> | undefined;
    if (!idCode || !idCodeType || !personalCode) return null;

    const format: IdCodeFormatConfig = {
      method: 'SUBSTRING',
      idCode: {
        startPosition: toIntegerOrNull(idCode.startPosition) ?? 0,
        length: toIntegerOrNull(idCode.length) ?? 0,
      },
      idCodeType: {
        startPosition: toIntegerOrNull(idCodeType.startPosition) ?? 0,
        length: toIntegerOrNull(idCodeType.length) ?? 0,
      },
      personalCode: {
        startPosition: toIntegerOrNull(personalCode.startPosition) ?? 0,
        length: toIntegerOrNull(personalCode.length) ?? 0,
      },
    };

    if (
      format.idCode.startPosition < 1 || format.idCode.length < 1 ||
      format.idCodeType.startPosition < 1 || format.idCodeType.length < 1 ||
      format.personalCode.startPosition < 1 || format.personalCode.length < 1
    ) {
      return null;
    }

    return format;
  }

  if (method === 'REGEX') {
    const idCode = cfg.idCode as Record<string, unknown> | undefined;
    const idCodeType = cfg.idCodeType as Record<string, unknown> | undefined;
    const personalCode = cfg.personalCode as Record<string, unknown> | undefined;
    if (!idCode || !idCodeType || !personalCode) return null;

    const format: IdCodeFormatConfig = {
      method: 'REGEX',
      idCode: {
        pattern: typeof idCode.pattern === 'string' ? idCode.pattern : '',
        flags: typeof idCode.flags === 'string' ? idCode.flags : '',
        group: toIntegerOrNull(idCode.group) ?? 0,
      },
      idCodeType: {
        pattern: typeof idCodeType.pattern === 'string' ? idCodeType.pattern : '',
        flags: typeof idCodeType.flags === 'string' ? idCodeType.flags : '',
        group: toIntegerOrNull(idCodeType.group) ?? 0,
      },
      personalCode: {
        pattern: typeof personalCode.pattern === 'string' ? personalCode.pattern : '',
        flags: typeof personalCode.flags === 'string' ? personalCode.flags : '',
        group: toIntegerOrNull(personalCode.group) ?? 0,
      },
    };

    if (
      format.idCode.pattern.length === 0 || format.idCode.group < 0 ||
      format.idCodeType.pattern.length === 0 || format.idCodeType.group < 0 ||
      format.personalCode.pattern.length === 0 || format.personalCode.group < 0
    ) {
      return null;
    }

    return format;
  }

  return null;
}

export async function upsertAppConfigs(items: AppConfigItem[]): Promise<void> {
  if (items.length === 0) return;

  if (USE_SESSION_MEMORY) {
    for (const item of items) {
      const configType = item.configType?.trim();
      const configId = item.configId?.trim();
      if (!configType || !configId) continue;
      memoryConfigs.set(`${configType}|${configId}`, {
        ...item,
        configType,
        configId,
        config: item.config ?? {},
        version: item.version ?? null,
        updatedAt: item.updatedAt ?? null,
      });
    }
    return;
  }

  const now = new Date().toISOString();

  await withWriteTransaction(async (db) => {
    for (const item of items) {
      const configType = item.configType?.trim();
      const configId = item.configId?.trim();
      if (!configType || !configId) continue;

      await db.runAsync(
        `INSERT OR REPLACE INTO app_config
          (configType, configId, enabled, configJson, version, updatedAt, lastSyncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          configType,
          configId,
          item.enabled ? 1 : 0,
          JSON.stringify(item.config ?? {}),
          item.version ?? null,
          item.updatedAt ?? null,
          now,
        ],
      );
    }
  });
}

export async function getAppConfigsByType(configType: string): Promise<AppConfigItem[]> {
  if (USE_SESSION_MEMORY) return memoryItemsByType(configType, false);

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM app_config WHERE configType = ? ORDER BY configId',
    [configType],
  );

  return rows.map(mapRowToAppConfigItem);
}

export async function getEnabledIdCodeFormat(): Promise<IdCodeFormatConfig | null> {
  if (USE_SESSION_MEMORY) {
    const [latest] = memoryItemsByType(CONFIG_TYPE.ID_CODE_FORMAT, true).sort((a, b) =>
      (b.version ?? 0) - (a.version ?? 0) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return latest ? mapToIdCodeFormat(latest) : null;
  }

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM app_config
     WHERE configType = ? AND enabled = 1
     ORDER BY COALESCE(version, 0) DESC, COALESCE(updatedAt, '') DESC
     LIMIT 1`,
    [CONFIG_TYPE.ID_CODE_FORMAT],
  );

  if (!row) return null;
  const item = mapRowToAppConfigItem(row);
  return mapToIdCodeFormat(item);
}

async function getEnabledIdCodeTypeItems(): Promise<AppConfigItem[]> {
  if (USE_SESSION_MEMORY) return memoryItemsByType(CONFIG_TYPE.ID_CODE_TYPE, true);

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM app_config
     WHERE configType = ? AND enabled = 1
     ORDER BY configId`,
    [CONFIG_TYPE.ID_CODE_TYPE],
  );
  return rows.map(mapRowToAppConfigItem);
}

export async function getIdCodeTypeMap(): Promise<Record<string, IdCodeTypeConfig>> {
  const items = await getEnabledIdCodeTypeItems();
  const map: Record<string, IdCodeTypeConfig> = {};

  for (const item of items) {
    const cfg = item.config as Record<string, unknown>;
    if (!cfg || typeof cfg !== 'object') continue;

    const configCode = typeof cfg.code === 'string' ? cfg.code.trim() : item.configId;
    if (!configCode) continue;

    map[configCode.toUpperCase()] = {
      code: configCode,
      type: normalizeIdCodeTypeName(cfg.type),
      name: typeof cfg.name === 'string' ? cfg.name : configCode,
      description: typeof cfg.description === 'string' ? cfg.description : null,
    };
  }

  return map;
}
