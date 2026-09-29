const AUDIENCE_PATTERNS: RegExp[] = [
  /^ALL$/,
  /^APP#(RIDER|MGMT)$/,
  /^PROFILE#[A-Za-z0-9._-]+$/,
  /^USER#[A-Za-z0-9._-]+$/,
  /^GROUP#[A-Za-z0-9._-]+$/,
  /^TOUR#[A-Za-z0-9._-]+#STATUS#[A-Za-z0-9._-]+$/,
  /^TOUR#[A-Za-z0-9._-]+#APPLICANTS$/,
  /^TOUR#[A-Za-z0-9._-]+#ALL$/,
  /^TOUR#[A-Za-z0-9._-]+#APP#(RIDER|MGMT)$/,
  /^TOUR#[A-Za-z0-9._-]+#GROUP#[A-Za-z0-9._-]+$/,
  /^TOUR#[A-Za-z0-9._-]+#RIDER#[A-Za-z0-9._-]+$/,
];

export function validateAudienceExpression(value: string): boolean {
  const expression = value.trim();
  if (!expression) return false;
  return AUDIENCE_PATTERNS.some((pattern) => pattern.test(expression));
}

export function splitAudienceExpressions(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateTemplate(value: string): boolean {
  const template = value.trim();
  if (!template) return false;
  const open = (template.match(/\{/g) ?? []).length;
  const close = (template.match(/\}/g) ?? []).length;
  return open === close;
}
