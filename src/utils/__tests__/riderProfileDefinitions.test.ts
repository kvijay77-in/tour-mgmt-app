import { describe, expect, it } from '@jest/globals';
import {
  evaluateVisibleWhen,
  moveAttributeDefinition,
  orderDefinitionsIntoSections,
} from '../riderProfileDefinitions';
import { RiderProfileAttributeDefinition, RiderProfileSectionDefinition } from '../../types/riderProfile';

function section(configId: string, order: number, enabled = true): RiderProfileSectionDefinition {
  return {
    configId,
    enabled,
    config: { label: configId, order },
  };
}

function attribute(
  configId: string,
  sectionId: string,
  order: number,
  enabled = true,
): RiderProfileAttributeDefinition {
  return {
    configId,
    enabled,
    config: {
      label: configId,
      sectionId,
      order,
      type: 'TEXT',
      storage: { scope: 'ATTRIBUTES' },
    },
  };
}

describe('orderDefinitionsIntoSections', () => {
  it('orders sections and attributes by order and excludes disabled/missing section data', () => {
    const sections = [
      section('medical', 2),
      section('basic', 1),
      section('hidden', 3, false),
    ];

    const attributes = [
      attribute('bloodGroup', 'medical', 2),
      attribute('allergies', 'medical', 1),
      attribute('nickname', 'basic', 1),
      attribute('retired', 'hidden', 1),
      attribute('orphan', 'missing', 1),
      attribute('disabled', 'basic', 2, false),
    ];

    const ordered = orderDefinitionsIntoSections(sections, attributes);

    expect(ordered.map((entry) => entry.sectionId)).toEqual(['basic', 'medical']);
    expect(ordered[0].attributes.map((entry) => entry.configId)).toEqual(['nickname']);
    expect(ordered[1].attributes.map((entry) => entry.configId)).toEqual(['allergies', 'bloodGroup']);
  });

  it('recomputes order when moving an attribute within or across sections', () => {
    const attributes = [
      attribute('first', 'basic', 1),
      attribute('second', 'basic', 2),
      attribute('third', 'medical', 1),
    ];

    const movedUp = moveAttributeDefinition(attributes, 'second', 'basic', 'up');
    const basicMovedUp = movedUp.filter((item) => item.config.sectionId === 'basic').sort((a, b) => a.config.order - b.config.order);
    expect(basicMovedUp.map((item) => `${item.configId}:${item.config.order}`)).toEqual(['second:1', 'first:2']);

    const movedSection = moveAttributeDefinition(attributes, 'second', 'medical');
    const medicalMoved = movedSection.filter((item) => item.config.sectionId === 'medical').sort((a, b) => a.config.order - b.config.order);
    expect(medicalMoved.map((item) => item.configId)).toEqual(['third', 'second']);
    expect(movedSection.map((item) => item.config.order)).toEqual([1, 2, 3]);
  });
});

describe('evaluateVisibleWhen', () => {
  it('evaluates EQ/NEQ/IN/NOT_EMPTY operators', () => {
    const values = {
      role: 'VIP',
      tags: ['A'],
      notes: 'hello',
      empty: '',
    };

    expect(evaluateVisibleWhen({ attribute: 'role', op: 'EQ', value: 'VIP' }, values)).toBe(true);
    expect(evaluateVisibleWhen({ attribute: 'role', op: 'NEQ', value: 'VIP' }, values)).toBe(false);
    expect(evaluateVisibleWhen({ attribute: 'role', op: 'IN', value: ['VIP', 'ELITE'] }, values)).toBe(true);
    expect(evaluateVisibleWhen({ attribute: 'tags', op: 'IN', value: ['B', 'A'] }, values)).toBe(true);
    expect(evaluateVisibleWhen({ attribute: 'notes', op: 'NOT_EMPTY' }, values)).toBe(true);
    expect(evaluateVisibleWhen({ attribute: 'empty', op: 'NOT_EMPTY' }, values)).toBe(false);
    expect(evaluateVisibleWhen({ attribute: 'role', op: 'UNKNOWN' as never }, values)).toBe(false);
    expect(evaluateVisibleWhen(undefined, values)).toBe(true);
  });
});
