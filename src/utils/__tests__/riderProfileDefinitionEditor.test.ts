import { describe, expect, it } from '@jest/globals';
import { validateAttributeDefinitionMutation } from '../riderProfileDefinitionEditor';
import { RiderProfileAttributeDefinition } from '../../types/riderProfile';

function makeDefinition(overrides: Partial<RiderProfileAttributeDefinition> = {}): RiderProfileAttributeDefinition {
  return {
    configId: 'personalCode',
    enabled: true,
    config: {
      label: 'Personal code',
      sectionId: 'identity',
      order: 1,
      type: 'TEXT',
      storage: { scope: 'CORE', path: 'personalCode' },
      system: true,
    },
    ...overrides,
  };
}

describe('validateAttributeDefinitionMutation', () => {
  it('blocks immutable key and type updates', () => {
    const previous = makeDefinition({ config: { ...makeDefinition().config, system: false } });

    const keyError = validateAttributeDefinitionMutation(previous, { ...previous, configId: 'newKey' });
    expect(keyError?.code).toBe('IMMUTABLE_KEY');

    const typeError = validateAttributeDefinitionMutation(previous, {
      ...previous,
      config: { ...previous.config, type: 'NUMBER' },
    });
    expect(typeError?.code).toBe('IMMUTABLE_TYPE');
  });

  it('protects system attributes from disable and storage changes', () => {
    const previous = makeDefinition();

    const disableError = validateAttributeDefinitionMutation(previous, { ...previous, enabled: false });
    expect(disableError?.code).toBe('SYSTEM_ATTRIBUTE_PROTECTED');

    const storageError = validateAttributeDefinitionMutation(previous, {
      ...previous,
      config: {
        ...previous.config,
        storage: { scope: 'CORE', path: 'new.path' },
      },
    });
    expect(storageError?.code).toBe('SYSTEM_ATTRIBUTE_PROTECTED');

    const scopeError = validateAttributeDefinitionMutation(previous, {
      ...previous,
      config: {
        ...previous.config,
        storage: { scope: 'ATTRIBUTES' },
      },
    });
    expect(scopeError?.code).toBe('SYSTEM_ATTRIBUTE_PROTECTED');
  });

  it('allows mutable presentation changes for system attributes', () => {
    const previous = makeDefinition();
    const next = {
      ...previous,
      config: {
        ...previous.config,
        label: 'Personal Code',
        helpText: 'Shown to admin only',
        order: 3,
      },
    };

    expect(validateAttributeDefinitionMutation(previous, next)).toBeNull();
  });
});
