import { AppConfigItem } from '../../types/config';
import {
  LovConfig,
  RiderProfileAttributeConfig,
  RiderProfileAttributeDefinition,
  RiderProfileGroupField,
  RiderProfileSectionConfig,
  RiderProfileSectionDefinition,
  RiderProfileLovDefinition,
} from '../../types/riderProfile';
import { listEnabledRiderProfileConfig } from '../api/riderProfileConfigApi';
import { getAppConfigsByType, upsertAppConfigs } from '../database/appConfigStore';

function toSectionDefinitions(items: AppConfigItem<RiderProfileSectionConfig>[]): RiderProfileSectionDefinition[] {
  return items.map((item) => ({
    configId: item.configId,
    enabled: item.enabled,
    version: item.version ?? null,
    config: item.config,
  }));
}

function toAttributeDefinitions(items: AppConfigItem<RiderProfileAttributeConfig>[]): RiderProfileAttributeDefinition[] {
  return items.map((item) => ({
    configId: item.configId,
    enabled: item.enabled,
    version: item.version ?? null,
    config: item.config,
  }));
}

function toLovDefinitions(items: AppConfigItem<LovConfig>[]): RiderProfileLovDefinition[] {
  return items.map((item) => ({
    configId: item.configId,
    enabled: item.enabled,
    version: item.version ?? null,
    config: item.config,
  }));
}

function collectReferencedLovIds(attributes: RiderProfileAttributeDefinition[]): Set<string> {
  const referenced = new Set<string>();

  const addFromGroupFields = (fields: RiderProfileGroupField[] | undefined) => {
    fields?.forEach((field) => {
      if (field.lovId) referenced.add(field.lovId);
    });
  };

  attributes.forEach((attribute) => {
    if (attribute.config.lovId) {
      referenced.add(attribute.config.lovId);
    }
    addFromGroupFields(attribute.config.fields);
  });

  return referenced;
}

function filterRiderProfileLovs(
  attributes: RiderProfileAttributeDefinition[],
  lovs: RiderProfileLovDefinition[],
): RiderProfileLovDefinition[] {
  const referenced = collectReferencedLovIds(attributes);
  let changed = true;

  while (changed) {
    changed = false;
    lovs.forEach((lov) => {
      if (lov.config.parentLovId && referenced.has(lov.config.parentLovId) && !referenced.has(lov.configId)) {
        referenced.add(lov.configId);
        changed = true;
      }
    });
  }

  return lovs.filter((lov) => referenced.has(lov.configId));
}

async function loadCachedDefinitions(): Promise<{
  sections: RiderProfileSectionDefinition[];
  attributes: RiderProfileAttributeDefinition[];
  lovs: RiderProfileLovDefinition[];
}> {
  const [sections, attributes, lovs] = await Promise.all([
    getAppConfigsByType('RIDER_PROFILE_SECTION'),
    getAppConfigsByType('RIDER_PROFILE_ATTRIBUTE'),
    getAppConfigsByType('LOV'),
  ]);

  const attributeDefinitions = toAttributeDefinitions(attributes as AppConfigItem<RiderProfileAttributeConfig>[]);
  const lovDefinitions = toLovDefinitions(lovs as AppConfigItem<LovConfig>[]);

  return {
    sections: toSectionDefinitions(sections as AppConfigItem<RiderProfileSectionConfig>[]),
    attributes: attributeDefinitions,
    lovs: filterRiderProfileLovs(attributeDefinitions, lovDefinitions),
  };
}

export async function refreshEnabledRiderProfileDefinitions(): Promise<void> {
  const [sections, attributes, lovs] = await Promise.all([
    listEnabledRiderProfileConfig('RIDER_PROFILE_SECTION'),
    listEnabledRiderProfileConfig('RIDER_PROFILE_ATTRIBUTE'),
    listEnabledRiderProfileConfig('LOV'),
  ]);

  await upsertAppConfigs([
    ...sections,
    ...attributes,
    ...lovs,
  ]);
}

export async function loadEnabledRiderProfileDefinitions(params?: {
  forceRefresh?: boolean;
}): Promise<{
  sections: RiderProfileSectionDefinition[];
  attributes: RiderProfileAttributeDefinition[];
  lovs: RiderProfileLovDefinition[];
}> {
  if (params?.forceRefresh) {
    await refreshEnabledRiderProfileDefinitions();
    return loadCachedDefinitions();
  }

  const cached = await loadCachedDefinitions();
  if (cached.sections.length > 0 || cached.attributes.length > 0 || cached.lovs.length > 0) {
    return cached;
  }

  await refreshEnabledRiderProfileDefinitions();
  return loadCachedDefinitions();
}
