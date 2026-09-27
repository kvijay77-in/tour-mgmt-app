import {
  CONFIG_TYPE,
  ERR_INVALID_ID_TYPE,
  ERR_INVALID_QR,
  ERR_RIDER_NOT_FOUND,
  ERR_TYPE_NOT_ALLOWED_FOR_EVENT,
  ID_CODE_TYPE,
} from '../../constants/idCodes';
import { IdCodeFormatConfig, IdCodeTypeConfig } from '../../types/config';
import { logger } from '../../utils/logger';
import { getEnabledIdCodeFormat, getIdCodeTypeMap } from '../database/appConfigStore';
import { getRiderIdByPersonalCode } from '../database/riderPersonalCodeStore';

const TAG = 'IdCodeService';
const MAX_QR_INPUT_LENGTH = 512;

export interface ParsedIdCode {
  idCode: string;
  typeCode: string;
  personalCode: string;
}

export type ScanResolution =
  | { ok: true; riderId: string; parsed: ParsedIdCode; typeCode: string; bagLabel?: string }
  | {
      ok: false;
      reason: 'INVALID_QR' | 'INVALID_TYPE' | 'RIDER_NOT_FOUND' | 'TYPE_NOT_ALLOWED_FOR_EVENT';
      message: string;
    };

interface SubstringPart {
  startPosition: number;
  length: number;
}

interface RegexPart {
  pattern: string;
  flags?: string;
  group: number;
}

function extractBySubstring(input: string, part: SubstringPart): string | null {
  if (!Number.isInteger(part.startPosition) || !Number.isInteger(part.length)) return null;
  if (part.startPosition < 1 || part.length < 1) return null;

  const startIndex = part.startPosition - 1;
  const endIndex = startIndex + part.length;
  if (startIndex >= input.length || endIndex > input.length) return null;

  return input.slice(startIndex, endIndex);
}

function extractByRegex(input: string, part: RegexPart): string | null {
  if (!Number.isInteger(part.group) || part.group < 0) return null;

  try {
    const regex = new RegExp(part.pattern, part.flags ?? '');
    const match = regex.exec(input);
    if (!match) return null;
    const captured = match[part.group];
    if (typeof captured !== 'string' || captured.length === 0) return null;
    return captured;
  } catch {
    return null;
  }
}

function normalizeUpper(value: string): string {
  return value.trim().toUpperCase();
}

export function extractLegacyRiderIdFromQr(rawValue?: string): string | null {
  const value = rawValue?.trim();
  if (!value) return null;

  const riderId = value.includes('|') ? value.split('|')[0]?.trim() : value;
  return riderId || null;
}

export function parseIdCode(rawQrText: string, format: IdCodeFormatConfig): ParsedIdCode | null {
  if (typeof rawQrText !== 'string' || rawQrText.length === 0) {
    return null;
  }

  if (format.method === 'SUBSTRING') {
    const idCode = extractBySubstring(rawQrText, format.idCode);
    if (!idCode) return null;

    const typeCode = extractBySubstring(idCode, format.idCodeType);
    const personalCode = extractBySubstring(idCode, format.personalCode);
    if (!typeCode || !personalCode) return null;

    return {
      idCode: normalizeUpper(idCode),
      typeCode: normalizeUpper(typeCode),
      personalCode: normalizeUpper(personalCode),
    };
  }

  const idCode = extractByRegex(rawQrText, format.idCode);
  if (!idCode) return null;

  const typeCode = extractByRegex(idCode, format.idCodeType);
  const personalCode = extractByRegex(idCode, format.personalCode);
  if (!typeCode || !personalCode) return null;

  return {
    idCode: normalizeUpper(idCode),
    typeCode: normalizeUpper(typeCode),
    personalCode: normalizeUpper(personalCode),
  };
}

export function formatTypeNotAllowedMessage(
  scannedTypeCode: string,
  allowedTypeCodes: readonly string[],
  typeMap: Record<string, IdCodeTypeConfig>,
): string {
  const nameOf = (code: string) => typeMap[code.toUpperCase()]?.name ?? code;
  const allowedNames = allowedTypeCodes.map(nameOf);
  return ERR_TYPE_NOT_ALLOWED_FOR_EVENT
    .replace('{scannedType}', nameOf(scannedTypeCode))
    .replace('{allowedTypes}', allowedNames.length > 0 ? allowedNames.join(', ') : '-');
}

/**
 * Resolve a scanned QR to a riderId.
 * Without allowedTypeCodes only RIDER codes are accepted (check-in behaviour).
 * With allowedTypeCodes the scanned type code must be one of them (event scanning).
 */
export async function resolveScannedRiderId(
  rawQrText: string,
  allowedTypeCodes?: readonly string[],
): Promise<ScanResolution> {
  const isDevLegacyMode = process.env.EXPO_PUBLIC_QR_DEV_FORMAT === 'true';

  if (isDevLegacyMode) {
    const riderId = extractLegacyRiderIdFromQr(rawQrText);
    if (!riderId) {
      return { ok: false, reason: 'INVALID_QR', message: ERR_INVALID_QR };
    }

    // Legacy dev format always yields type '1'; type filtering is not testable in this mode.
    return {
      ok: true,
      riderId,
      typeCode: '1',
      parsed: {
        idCode: riderId,
        typeCode: '1',
        personalCode: riderId,
      },
    };
  }

  if (typeof rawQrText !== 'string') {
    return { ok: false, reason: 'INVALID_QR', message: ERR_INVALID_QR };
  }

  const trimmedInput = rawQrText.trim();
  if (trimmedInput.length === 0 || trimmedInput.length > MAX_QR_INPUT_LENGTH) {
    return { ok: false, reason: 'INVALID_QR', message: ERR_INVALID_QR };
  }

  const activeFormat = await getEnabledIdCodeFormat();
  if (!activeFormat) {
    throw new Error(`Missing mandatory Config - ${CONFIG_TYPE.ID_CODE_FORMAT}`);
  }

  const typeMap = await getIdCodeTypeMap();
  if (Object.keys(typeMap).length === 0) {
    throw new Error(`Missing mandatory Config - ${CONFIG_TYPE.ID_CODE_TYPE}`);
  }

  const parsed = parseIdCode(trimmedInput, activeFormat);
  if (!parsed) {
    return { ok: false, reason: 'INVALID_QR', message: ERR_INVALID_QR };
  }

  logger.debug(TAG, 'Parsed QR ID code', { idCode: parsed.idCode });

  const resolvedType = typeMap[parsed.typeCode];
  if (allowedTypeCodes) {
    const allowed = allowedTypeCodes.map((code) => code.toUpperCase());
    if (!resolvedType || !allowed.includes(parsed.typeCode)) {
      return {
        ok: false,
        reason: 'TYPE_NOT_ALLOWED_FOR_EVENT',
        message: formatTypeNotAllowedMessage(parsed.typeCode, allowedTypeCodes, typeMap),
      };
    }
  } else if (!resolvedType || resolvedType.type !== ID_CODE_TYPE.RIDER) {
    return { ok: false, reason: 'INVALID_TYPE', message: ERR_INVALID_ID_TYPE };
  }

  const riderId = await getRiderIdByPersonalCode(parsed.personalCode);
  if (!riderId) {
    return { ok: false, reason: 'RIDER_NOT_FOUND', message: ERR_RIDER_NOT_FOUND };
  }

  return { ok: true, riderId, parsed, typeCode: parsed.typeCode, bagLabel: resolvedType.name };
}
