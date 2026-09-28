import {
  LovItem,
  OrderedRiderProfileSection,
  RiderProfileAttributeDefinition,
  RiderProfileSectionDefinition,
  RiderProfileVisibleWhen,
} from '../types/riderProfile';

function sortByOrder<T extends { config: { order: number }; configId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.config.order - b.config.order || a.configId.localeCompare(b.configId));
}

function cloneWithOrder<T extends { config: { order: number } }>(item: T, order: number): T {
  return {
    ...item,
    config: {
      ...item.config,
      order,
    },
  };
}

export function recomputeDefinitionOrders<T extends { config: { order: number } }>(items: T[]): T[] {
  return items.map((item, index) => cloneWithOrder(item, index + 1));
}

export function moveOrderedDefinition<T extends { config: { order: number }; configId: string }>(
  items: T[],
  configId: string,
  direction: 'up' | 'down',
): T[] {
  const ordered = sortByOrder(items);
  const index = ordered.findIndex((item) => item.configId === configId);
  if (index < 0) return ordered;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) {
    return recomputeDefinitionOrders(ordered);
  }

  const next = [...ordered];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return recomputeDefinitionOrders(next);
}

export function moveAttributeDefinition(
  attributes: RiderProfileAttributeDefinition[],
  configId: string,
  targetSectionId: string,
  direction?: 'up' | 'down',
): RiderProfileAttributeDefinition[] {
  const sorted = sortByOrder(attributes);
  const target = sorted.find((attribute) => attribute.configId === configId);
  if (!target) return sorted;

  const updatedAttributes = sorted.map((attribute) =>
    attribute.configId === configId
      ? {
        ...attribute,
        config: {
          ...attribute.config,
          sectionId: targetSectionId,
        },
      }
      : attribute);

  const grouped = new Map<string, RiderProfileAttributeDefinition[]>();
  for (const attribute of updatedAttributes) {
    const list = grouped.get(attribute.config.sectionId) ?? [];
    list.push(attribute);
    grouped.set(attribute.config.sectionId, list);
  }

  if (direction) {
    const targetSection = grouped.get(targetSectionId) ?? [];
    grouped.set(targetSectionId, moveOrderedDefinition(targetSection, configId, direction));
  }

  const result: RiderProfileAttributeDefinition[] = [];
  let globalOrder = 1;
  for (const [sectionId, list] of grouped.entries()) {
    const ordered = sortByOrder(list).map((item) => cloneWithOrder(item, globalOrder++));
    grouped.set(sectionId, ordered);
    result.push(...ordered);
  }

  return result;
}

export function recomputeLovItemOrders(items: LovItem[]): LovItem[] {
  return [...items]
    .sort((a, b) => a.order - b.order || a.value.localeCompare(b.value))
    .map((item, index) => ({
      ...item,
      order: index + 1,
    }));
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
