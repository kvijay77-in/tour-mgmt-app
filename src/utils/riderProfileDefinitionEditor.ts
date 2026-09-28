import { LovItem, RiderProfileAttributeDefinition } from '../types/riderProfile';

export type DefinitionGuardErrorCode =
  | 'IMMUTABLE_KEY'
  | 'IMMUTABLE_TYPE'
  | 'SYSTEM_ATTRIBUTE_PROTECTED';

export interface DefinitionGuardError {
  code: DefinitionGuardErrorCode;
  message: string;
}

export interface LovCsvParseResult {
  items: LovItem[];
  errors: string[];
}

export interface RiderProfileConfigSaveRequest<T> {
  version: number;
  enabled: boolean;
  description?: string;
  config: T;
}

export interface AdminProfileUpdatePayload {
  definitionsVersion: number;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

function normalizeDescription(description: string | null | undefined): string | undefined {
  if (typeof description !== 'string') return undefined;
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function setPathValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) return;

  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const existing = cursor[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateAttributeDefinitionMutation(
  previous: RiderProfileAttributeDefinition,
  next: RiderProfileAttributeDefinition,
): DefinitionGuardError | null {
  if (previous.configId !== next.configId) {
    return {
      code: 'IMMUTABLE_KEY',
      message: 'Attribute key cannot be changed after creation.',
    };
  }

  if (previous.config.type !== next.config.type) {
    return {
      code: 'IMMUTABLE_TYPE',
      message: 'Attribute type cannot be changed after creation.',
    };
  }

  if (previous.config.system) {
    if (!next.enabled) {
      return {
        code: 'SYSTEM_ATTRIBUTE_PROTECTED',
        message: 'System attributes cannot be disabled.',
      };
    }

    if (previous.config.storage.scope !== next.config.storage.scope) {
      return {
        code: 'SYSTEM_ATTRIBUTE_PROTECTED',
        message: 'System attribute storage is locked.',
      };
    }

    if (previous.config.storage.scope === 'CORE' && next.config.storage.scope === 'CORE') {
      if (previous.config.storage.path !== next.config.storage.path) {
        return {
          code: 'SYSTEM_ATTRIBUTE_PROTECTED',
          message: 'System attribute storage path is locked.',
        };
      }
    }
  }

  return null;
}

export function buildRiderProfileConfigSaveRequest<T>(params: {
  config: T;
  enabled: boolean;
  description?: string | null;
  version?: number | null;
}): RiderProfileConfigSaveRequest<T> {
  return {
    version: params.version ?? 0,
    enabled: params.enabled,
    description: normalizeDescription(params.description),
    config: params.config,
  };
}

export function parseLovCsv(text: string): LovCsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) {
    return { items: [], errors: ['CSV is empty.'] };
  }

  const [headerLine, ...rows] = lines;
  const headers = splitCsvLine(headerLine).map((value) => value.trim().toLowerCase());
  const valueIndex = headers.indexOf('value');
  const labelIndex = headers.indexOf('label');
  const orderIndex = headers.indexOf('order');
  const parentIndex = headers.indexOf('parent');

  if (valueIndex < 0 || labelIndex < 0) {
    return { items: [], errors: ['CSV header must include value and label columns.'] };
  }

  const items: LovItem[] = [];
  const errors: string[] = [];

  rows.forEach((row, rowIndex) => {
    const values = splitCsvLine(row);
    const value = values[valueIndex]?.trim();
    const label = values[labelIndex]?.trim();
    const orderText = orderIndex >= 0 ? values[orderIndex]?.trim() : '';
    const parent = parentIndex >= 0 ? values[parentIndex]?.trim() : '';

    if (!value || !label) {
      errors.push(`Row ${rowIndex + 2}: value and label are required.`);
      return;
    }

    const parsedOrder = orderText ? Number(orderText) : items.length + 1;
    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) {
      errors.push(`Row ${rowIndex + 2}: order must be a non-negative number.`);
      return;
    }

    items.push({
      value,
      label,
      order: Math.trunc(parsedOrder),
      enabled: true,
      parent: parent || undefined,
    });
  });

  return { items, errors };
}

export function mergeLovItems(
  existingItems: LovItem[],
  importedItems: LovItem[],
  mode: 'merge' | 'replace',
): LovItem[] {
  if (mode === 'replace') {
    return importedItems.map((item) => ({
      ...item,
      enabled: item.enabled ?? true,
    }));
  }

  const existingByValue = new Map(existingItems.map((item) => [item.value, item]));
  const touchedValues = new Set<string>();
  const merged: LovItem[] = importedItems.map((item) => {
    const existing = existingByValue.get(item.value);
    touchedValues.add(item.value);
    return {
      ...existing,
      ...item,
      enabled: existing?.enabled ?? item.enabled ?? true,
      meta: existing?.meta ?? item.meta,
    };
  });

  for (const existing of existingItems) {
    if (!touchedValues.has(existing.value)) {
      merged.push(existing);
    }
  }

  return merged;
}

export function buildAdminProfileUpdatePayload(params: {
  definitionsVersion: number;
  currentCore: Record<string, unknown>;
  currentAttributes?: Record<string, unknown>;
  nextValues: Record<string, unknown>;
  definitions: RiderProfileAttributeDefinition[];
}): AdminProfileUpdatePayload {
  const payload: AdminProfileUpdatePayload = {
    definitionsVersion: params.definitionsVersion,
  };
  const attributeChanges: Record<string, unknown> = {};

  params.definitions.forEach((definition) => {
    const nextValue = params.nextValues[definition.configId];
    const currentValue = definition.config.storage.scope === 'CORE'
      ? getPathValue(params.currentCore, definition.config.storage.path)
      : params.currentAttributes?.[definition.configId];

    if (sameValue(currentValue, nextValue)) {
      return;
    }

    if (definition.config.storage.scope === 'CORE') {
      setPathValue(payload, definition.config.storage.path, nextValue);
      return;
    }

    attributeChanges[definition.configId] = nextValue;
  });

  if (Object.keys(attributeChanges).length > 0) {
    payload.attributes = attributeChanges;
  }

  return payload;
}
