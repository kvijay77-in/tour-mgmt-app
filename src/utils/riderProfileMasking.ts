export interface MaskDecision {
  masked: boolean;
  displayValue: string;
}

const MASK = '••••••';

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function getMaskedAttributeDisplay(
  key: string,
  value: unknown,
  sensitiveKeys: readonly string[] | undefined,
  revealedKeys: ReadonlySet<string> = new Set(),
): MaskDecision {
  const isSensitive = Boolean(sensitiveKeys?.includes(key));
  const revealed = revealedKeys.has(key);

  if (!isSensitive || revealed) {
    return { masked: false, displayValue: stringify(value) };
  }

  return { masked: true, displayValue: MASK };
}
