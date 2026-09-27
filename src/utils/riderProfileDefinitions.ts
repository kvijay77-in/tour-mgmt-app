import {
  OrderedRiderProfileSection,
  RiderProfileAttributeDefinition,
  RiderProfileSectionDefinition,
  RiderProfileVisibleWhen,
} from '../types/riderProfile';

function sortByOrder<T extends { config: { order: number }; configId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.config.order - b.config.order || a.configId.localeCompare(b.configId));
}

export function orderDefinitionsIntoSections(
  sections: RiderProfileSectionDefinition[],
  attributes: RiderProfileAttributeDefinition[],
): OrderedRiderProfileSection[] {
  const enabledSections = sections.filter((section) => section.enabled);
  const enabledAttributes = attributes.filter((attribute) => attribute.enabled);

  const sectionById = new Map(enabledSections.map((section) => [section.configId, section]));
  const grouped = new Map<string, RiderProfileAttributeDefinition[]>();

  for (const attribute of enabledAttributes) {
    const sectionId = attribute.config.sectionId;
    if (!sectionById.has(sectionId)) continue;

    const list = grouped.get(sectionId) ?? [];
    list.push(attribute);
    grouped.set(sectionId, list);
  }

  return sortByOrder(enabledSections).map((section) => ({
    sectionId: section.configId,
    section,
    attributes: sortByOrder(grouped.get(section.configId) ?? []),
  }));
}

function normalizeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

export function evaluateVisibleWhen(
  rule: RiderProfileVisibleWhen | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!rule) return true;

  const sourceValue = values[rule.attribute];

  switch (rule.op) {
    case 'EQ':
      return sourceValue === rule.value;
    case 'NEQ':
      return sourceValue !== rule.value;
    case 'IN': {
      const candidates = normalizeArray(rule.value);
      if (Array.isArray(sourceValue)) {
        return sourceValue.some((item) => candidates.includes(item));
      }
      return candidates.includes(sourceValue);
    }
    case 'NOT_EMPTY':
      if (Array.isArray(sourceValue)) return sourceValue.length > 0;
      return sourceValue !== null && sourceValue !== undefined && String(sourceValue).trim().length > 0;
    default:
      return false;
  }
}
