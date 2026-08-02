export const ID_CODE_TYPE = {
  RIDER: 'RIDER',
  CYCLE: 'CYCLE',
  BAGGAGE: 'BAGGAGE',
} as const;

export const CONFIG_TYPE = {
  ID_CODE_FORMAT: 'ID_CODE_FORMAT',
  ID_CODE_TYPE: 'ID_CODE_TYPE',
} as const;

export const ERR_INVALID_ID_TYPE = 'Invalid ID type. Only Rider ID allowed.';
export const ERR_INVALID_QR = 'Invalid QR code.';
export const ERR_RIDER_NOT_FOUND = 'Rider not found for this ID code.';
