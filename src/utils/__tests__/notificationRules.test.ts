import { describe, expect, it } from '@jest/globals';
import { splitAudienceExpressions, validateAudienceExpression, validateTemplate } from '../notificationRules';

describe('notificationRules utilities', () => {
  it('accepts supported audience expressions', () => {
    expect(validateAudienceExpression('ALL')).toBe(true);
    expect(validateAudienceExpression('APP#RIDER')).toBe(true);
    expect(validateAudienceExpression('GROUP#SUPER_USER')).toBe(true);
    expect(validateAudienceExpression('TOUR#TOT-2026#APP#MGMT')).toBe(true);
    expect(validateAudienceExpression('TOUR#TOT-2026#RIDER#R123')).toBe(true);
  });

  it('rejects unsupported audience expressions', () => {
    expect(validateAudienceExpression('')).toBe(false);
    expect(validateAudienceExpression('TOUR#ONLY')).toBe(false);
    expect(validateAudienceExpression('APP#UNKNOWN')).toBe(false);
  });

  it('splits newline/comma audience lists', () => {
    expect(splitAudienceExpressions('ALL,\nAPP#RIDER , USER#123')).toEqual(['ALL', 'APP#RIDER', 'USER#123']);
  });

  it('validates templates with balanced braces', () => {
    expect(validateTemplate('Hello {name}')).toBe(true);
    expect(validateTemplate('')).toBe(false);
    expect(validateTemplate('Hello {name')).toBe(false);
  });
});
