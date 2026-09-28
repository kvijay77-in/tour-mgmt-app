export type RiderProfileConfigType = 'RIDER_PROFILE_SECTION' | 'RIDER_PROFILE_ATTRIBUTE' | 'LOV';

export const RIDER_PROFILE_CONFIG_TYPES: readonly RiderProfileConfigType[] = [
  'RIDER_PROFILE_SECTION',
  'RIDER_PROFILE_ATTRIBUTE',
  'LOV',
];

export type RiderProfileAttributeType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'EMAIL'
  | 'PHONE'
  | 'URL'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'FILE'
  | 'IMAGE'
  | 'GROUP';

export type RiderProfileVisibleWhenOp = 'EQ' | 'NEQ' | 'IN' | 'NOT_EMPTY';

export type RiderProfileKnownHandler = 'PERSONAL_CODE' | 'COGNITO_EMAIL' | 'PROFILE_PHOTO';

export interface RiderProfileSectionConfig {
  label: string;
  icon?: string;
  order: number;
  description?: string;
}

export type RiderProfileStorage =
  | { scope: 'CORE'; path: string }
  | { scope: 'ATTRIBUTES' };

export interface RiderProfileVisibleWhen {
  attribute: string;
  op: RiderProfileVisibleWhenOp;
  value?: unknown;
}

export interface RiderProfileValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  decimals?: number;
  unit?: string;
  minDate?: string;
  maxDate?: string;
  minItems?: number;
  maxItems?: number;
  allowedMimeTypes?: string[];
  maxFileSizeBytes?: number;
}

export interface RiderProfileGroupField {
  key: string;
  label: string;
  type: Exclude<RiderProfileAttributeType, 'GROUP'>;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  validation?: RiderProfileValidation;
  lovId?: string;
  dependsOn?: string;
  fallbackToText?: boolean;
}

export interface RiderProfileAttributeConfig {
  label: string;
  helpText?: string;
  placeholder?: string;
  sectionId: string;
  order: number;
  type: RiderProfileAttributeType;
  lovId?: string;
  storage: RiderProfileStorage;
  required?: boolean;
  adminOnly?: boolean;
  sensitive?: boolean;
  visibleToAllMgmtUsers?: boolean;
  system?: boolean;
  validation?: RiderProfileValidation;
  visibleWhen?: RiderProfileVisibleWhen;
  dependsOn?: string;
  fallbackToText?: boolean;
  fields?: RiderProfileGroupField[];
  repeatable?: boolean;
  maxItems?: number;
  handler?: RiderProfileKnownHandler | string;
  handlerOptions?: Record<string, unknown>;
}

export interface LovItem {
  value: string;
  label: string;
  order: number;
  enabled?: boolean;
  parent?: string;
  meta?: Record<string, unknown>;
}

export interface LovConfig {
  label: string;
  parentLovId?: string;
  items: LovItem[];
}

export interface RiderProfileSectionDefinition {
  configId: string;
  enabled: boolean;
  version?: number | null;
  config: RiderProfileSectionConfig;
}

export interface RiderProfileAttributeDefinition {
  configId: string;
  enabled: boolean;
  version?: number | null;
  config: RiderProfileAttributeConfig;
}

export interface RiderProfileLovDefinition {
  configId: string;
  enabled: boolean;
  version?: number | null;
  config: LovConfig;
}

export interface OrderedRiderProfileSection {
  sectionId: string;
  section: RiderProfileSectionDefinition;
  attributes: RiderProfileAttributeDefinition[];
}
