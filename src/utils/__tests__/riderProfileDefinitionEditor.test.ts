import { describe, expect, it } from '@jest/globals';
import {
  buildAdminProfileUpdatePayload,
  buildRiderProfileConfigSaveRequest,
  parseLovCsv,
  validateAttributeDefinitionMutation,
} from '../riderProfileDefinitionEditor';
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

describe('parseLovCsv', () => {
  it('parses simple value,label,order,parent rows', () => {
    const parsed = parseLovCsv([
      'value,label,order,parent',
      'A,Alpha,2,',
      '"B","Bravo",3,A',
    ].join('\n'));

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual([
      { value: 'A', label: 'Alpha', order: 2, enabled: true, parent: undefined },
      { value: 'B', label: 'Bravo', order: 3, enabled: true, parent: 'A' },
    ]);
  });

  it('handles quoted commas and reports validation errors', () => {
    const parsed = parseLovCsv([
      'value,label,order,parent',
      '"A","Alpha, One",1,',
      'B,Bravo,not-a-number,',
      ',Missing value,2,',
      '"C","Quote ""Inside""",3,',
    ].join('\n'));

    expect(parsed.items).toEqual([
      { value: 'A', label: 'Alpha, One', order: 1, enabled: true, parent: undefined },
      { value: 'C', label: 'Quote "Inside"', order: 3, enabled: true, parent: undefined },
    ]);
    expect(parsed.errors).toEqual([
      'Row 3: order must be a non-negative number.',
      'Row 4: value and label are required.',
    ]);
  });
});

describe('buildAdminProfileUpdatePayload', () => {
  it('sends only changed core fields and changed attributes plus definitionsVersion', () => {
    const definitions: RiderProfileAttributeDefinition[] = [
      {
        configId: 'personalCode',
        enabled: true,
        config: {
          label: 'Personal code',
          sectionId: 'identity',
          order: 1,
          type: 'TEXT',
          storage: { scope: 'CORE', path: 'personalCode' },
          adminOnly: true,
        },
      },
      {
        configId: 'bloodGroup',
        enabled: true,
        config: {
          label: 'Blood group',
          sectionId: 'medical',
          order: 2,
          type: 'TEXT',
          storage: { scope: 'ATTRIBUTES' },
          adminOnly: true,
        },
      },
    ];

    const payload = buildAdminProfileUpdatePayload({
      definitionsVersion: 77,
      currentCore: { personalCode: 'D220' },
      currentAttributes: { bloodGroup: 'A+' },
      nextValues: { personalCode: 'D221', bloodGroup: 'A+' },
      definitions,
    });

    expect(payload).toEqual({
      definitionsVersion: 77,
      personalCode: 'D221',
    });
  });

  it('supports nested CORE storage paths', () => {
    const payload = buildAdminProfileUpdatePayload({
      definitionsVersion: 5,
      currentCore: {
        emergencyContact: {
          phone: '+911234',
        },
      },
      nextValues: {
        emergencyPhone: '+919999',
      },
      definitions: [{
        configId: 'emergencyPhone',
        enabled: true,
        config: {
          label: 'Emergency phone',
          sectionId: 'contact',
          order: 1,
          type: 'PHONE',
          storage: { scope: 'CORE', path: 'emergencyContact.phone' },
          adminOnly: true,
        },
      }],
    });

    expect(payload).toEqual({
      definitionsVersion: 5,
      emergencyContact: {
        phone: '+919999',
      },
    });
  });
});

describe('buildRiderProfileConfigSaveRequest', () => {
  it('sends version 0 for create and current version for update', () => {
    const createPayload = buildRiderProfileConfigSaveRequest({
      enabled: true,
      config: { label: 'Section', order: 1 },
    });
    const updatePayload = buildRiderProfileConfigSaveRequest({
      enabled: false,
      version: 5,
      config: { label: 'Section', order: 1 },
    });

    expect(createPayload.version).toBe(0);
    expect(updatePayload.version).toBe(5);
  });
});
