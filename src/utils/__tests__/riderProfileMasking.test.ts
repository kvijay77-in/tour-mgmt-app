import { describe, expect, it } from '@jest/globals';
import { getMaskedAttributeDisplay } from '../riderProfileMasking';

describe('getMaskedAttributeDisplay', () => {
  it('masks only sensitive keys unless revealed', () => {
    const sensitiveKeys = ['personalCode'];

    const masked = getMaskedAttributeDisplay('personalCode', 'D220', sensitiveKeys);
    expect(masked).toEqual({ masked: true, displayValue: '••••••' });

    const revealed = getMaskedAttributeDisplay('personalCode', 'D220', sensitiveKeys, new Set(['personalCode']));
    expect(revealed).toEqual({ masked: false, displayValue: 'D220' });

    const plain = getMaskedAttributeDisplay('bloodGroup', 'A+', sensitiveKeys);
    expect(plain).toEqual({ masked: false, displayValue: 'A+' });
  });

  it('stringifies non-string values and handles nullish values', () => {
    const obj = getMaskedAttributeDisplay('medical', { allergies: ['Nuts'] }, []);
    expect(obj).toEqual({ masked: false, displayValue: JSON.stringify({ allergies: ['Nuts'] }) });

    const empty = getMaskedAttributeDisplay('notes', null, []);
    expect(empty).toEqual({ masked: false, displayValue: '' });
  });
});
