import { AppConfigItem } from '../../types/config';
import {
  LovConfig,
  RiderProfileAttributeConfig,
  RiderProfileAttributeDefinition,
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

  return {
    sections: toSectionDefinitions(sections as AppConfigItem<RiderProfileSectionConfig>[]),
    attributes: toAttributeDefinitions(attributes as AppConfigItem<RiderProfileAttributeConfig>[]),
    lovs: toLovDefinitions(lovs as AppConfigItem<LovConfig>[]),
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
