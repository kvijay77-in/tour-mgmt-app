/**
 * User-management service for administrator workflows.
 *
 * IMPORTANT:
 * - This client app must not call Cognito admin SDKs directly.
 * - All user-management operations are routed through tour-data-api.
 */

import { apiClient } from '../api/apiClient';
import { logger } from '../../utils/logger';

const TAG = 'CognitoUserManagementService';

export interface CognitoManagedUser {
  cognitoUserId: string;
  username: string;
  email: string;
  phoneNumber?: string;
  name?: string;
  enabled: boolean;
  status?: string;
  roles: string[];
}

export interface NewCognitoUserInput {
  email: string;
  phoneNumber?: string;
  name?: string;
  roles: string[];
}

export interface UpdateCognitoUserProfileInput {
  email?: string;
  phoneNumber?: string;
  name?: string;
  roles?: string[];
}

interface UsersResponse {
  users?: ManagedUserApiModel[];
  Users?: ManagedUserApiModel[];
  items?: ManagedUserApiModel[];
}

interface RoleGroupsResponse {
  groups?: string[];
  roles?: string[];
}

interface ApiLogicalErrorEnvelope {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
  data?: unknown;
}

interface ManagedUserApiModel {
  cognitoUserId?: string;
  userId?: string;
  sub?: string;
  cognitoSub?: string;
  id?: string;
  usernameId?: string;
  username?: string;
  Username?: string;
  email?: string;
  Email?: string;
  phoneNumber?: string;
  PhoneNumber?: string;
  phone?: string;
  name?: string;
  Name?: string;
  enabled?: boolean;
  Enabled?: boolean;
  status?: string;
  userStatus?: string;
  UserStatus?: string;
  roles?: string[];
  groups?: string[];
  groupNames?: string[];
  Groups?: string[];
  attributes?: Array<{
    Name?: string;
    Value?: string;
    name?: string;
    value?: string;
  }>;
  Attributes?: Array<{
    Name?: string;
    Value?: string;
    name?: string;
    value?: string;
  }>;
  userAttributes?: Array<{
    Name?: string;
    Value?: string;
    name?: string;
    value?: string;
  }>;
  attributeList?: Array<{
    Name?: string;
    Value?: string;
    name?: string;
    value?: string;
  }>;
  attributesMap?: Record<string, unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapApiPayload<T>(response: unknown): T | undefined {
  if (isObjectRecord(response)) {
    const envelope = response as ApiLogicalErrorEnvelope;

    if (envelope.success === false) {
      const message = envelope.error?.message ?? 'User management API returned an unsuccessful response.';
      throw new Error(message);
    }

    if ('data' in response) {
      if (envelope.data !== undefined && envelope.data !== null) {
        return envelope.data as T;
      }
      return response as T;
    }
  }
  return response as T;
}

function getObjectKeys(value: unknown): string[] {
  if (!isObjectRecord(value)) return [];
  return Object.keys(value).sort((a, b) => a.localeCompare(b, 'en'));
}

function toUserIdPathSegment(cognitoUserId: string): string {
  const normalized = cognitoUserId.trim();
  if (!normalized) {
    throw new Error('Selected user does not have a valid Cognito user identifier. Please refresh the list and try again.');
  }

  return encodeURIComponent(normalized);
}

// Prefer canonical UUID-like identifiers when available, but support non-UUID IDs.
function isStrictUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getStrictUuidSubstring(value: string): string | null {
  const match = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}

function getSubFromAttributes(
  attributes: ManagedUserApiModel['attributes'],
): string | undefined {
  if (!Array.isArray(attributes)) return undefined;

  for (const attribute of attributes) {
    const key = attribute.Name ?? attribute.name;
    const value = attribute.Value ?? attribute.value;
    if (key === 'sub' && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function getAttributeValue(
  attributes: ManagedUserApiModel['attributes'],
  keyName: string,
): string | undefined {
  if (!Array.isArray(attributes)) return undefined;

  for (const attribute of attributes) {
    const key = attribute.Name ?? attribute.name;
    const value = attribute.Value ?? attribute.value;
    if (key === keyName && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function getNormalizedAttributes(
  raw: ManagedUserApiModel,
): ManagedUserApiModel['attributes'] {
  if (Array.isArray(raw.attributes)) return raw.attributes;
  if (Array.isArray(raw.Attributes)) return raw.Attributes;
  if (Array.isArray(raw.userAttributes)) return raw.userAttributes;
  if (Array.isArray(raw.attributeList)) return raw.attributeList;
  return undefined;
}

function getAttributeValueFromMap(raw: ManagedUserApiModel, keyName: string): string | undefined {
  const map = raw.attributesMap;
  if (!map || typeof map !== 'object') return undefined;

  const direct = map[keyName];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const alt = map[keyName.toLowerCase()];
  if (typeof alt === 'string' && alt.trim()) {
    return alt.trim();
  }

  return undefined;
}

function collectAllStringValues(raw: ManagedUserApiModel): string[] {
  const values: string[] = [];
  const record = raw as Record<string, unknown>;

  for (const value of Object.values(record)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) values.push(trimmed);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          if (trimmed) values.push(trimmed);
          continue;
        }

        if (entry && typeof entry === 'object') {
          for (const nested of Object.values(entry as Record<string, unknown>)) {
            if (typeof nested === 'string') {
              const trimmed = nested.trim();
              if (trimmed) values.push(trimmed);
            }
          }
        }
      }
      continue;
    }

    if (value && typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        if (typeof nested === 'string') {
          const trimmed = nested.trim();
          if (trimmed) values.push(trimmed);
        }
      }
    }
  }

  return values;
}

function resolveCognitoUserId(raw: ManagedUserApiModel): string | null {
  const attributes = getNormalizedAttributes(raw);
  const mapSub = getAttributeValueFromMap(raw, 'sub');
  const mapCognitoSub = getAttributeValueFromMap(raw, 'cognitoSub');
  const candidates = [
    raw.sub,
    raw.cognitoSub,
    raw.cognitoUserId,
    raw.userId,
    raw.id,
    raw.usernameId,
    getSubFromAttributes(attributes),
    mapSub,
    mapCognitoSub,
  ]
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  const strictUuid = candidates.find((candidate) => isStrictUuid(candidate));
  if (strictUuid) {
    return strictUuid;
  }

  const discovered = collectAllStringValues(raw)
    .map((value) => getStrictUuidSubstring(value))
    .find((value): value is string => typeof value === 'string' && value.length > 0);

  if (discovered) {
    return discovered;
  }

  return candidates[0] ?? null;
}

function normalizeManagedUser(raw: ManagedUserApiModel): CognitoManagedUser | null {
  const attributes = getNormalizedAttributes(raw);
  const cognitoUserId = resolveCognitoUserId(raw);
  const email =
    raw.email ??
    raw.Email ??
    getAttributeValue(attributes, 'email') ??
    getAttributeValue(attributes, 'custom:email') ??
    getAttributeValueFromMap(raw, 'email') ??
    raw.username ??
    raw.Username;

  if (!cognitoUserId || !email) {
    return null;
  }

  const username = raw.username ?? raw.Username ?? email;
  const roles = Array.isArray(raw.roles)
    ? raw.roles
    : Array.isArray(raw.groups)
      ? raw.groups
      : Array.isArray(raw.groupNames)
        ? raw.groupNames
        : Array.isArray(raw.Groups)
          ? raw.Groups
      : [];

  return {
    cognitoUserId,
    username,
    email,
    phoneNumber:
      raw.phoneNumber ??
      raw.PhoneNumber ??
      raw.phone ??
      getAttributeValue(attributes, 'phone_number') ??
      getAttributeValueFromMap(raw, 'phone_number') ??
      getAttributeValueFromMap(raw, 'phoneNumber'),
    name:
      raw.name ??
      raw.Name ??
      getAttributeValue(attributes, 'name') ??
      getAttributeValueFromMap(raw, 'name'),
    enabled: raw.enabled ?? raw.Enabled ?? true,
    status: raw.status ?? raw.userStatus ?? raw.UserStatus,
    roles: [...new Set(roles)].sort((a, b) => a.localeCompare(b, 'en')),
  };
}

export async function listAvailableRoleGroups(): Promise<string[]> {
  const response = await apiClient.get<RoleGroupsResponse>('/v1/admin/usermgmt/roles');

  const data = unwrapApiPayload<RoleGroupsResponse | string[]>(response);
  const values = Array.isArray(data)
    ? data
    : data?.groups ?? data?.roles ?? [];

  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

export async function listCognitoUsersWithRoles(): Promise<CognitoManagedUser[]> {
  const response = await apiClient.get<UsersResponse>('/v1/admin/usermgmt/users');

  const payload = unwrapApiPayload<
    | UsersResponse
    | { items?: ManagedUserApiModel[]; Users?: ManagedUserApiModel[]; data?: UsersResponse }
    | ManagedUserApiModel[]
    | undefined
  >(response);

  function extractManagedUserArray(value: unknown): ManagedUserApiModel[] {
    if (Array.isArray(value)) return value as ManagedUserApiModel[];
    if (!isObjectRecord(value)) return [];

    const asUsers = value as UsersResponse & Record<string, unknown>;
    if (Array.isArray(asUsers.users)) return asUsers.users as ManagedUserApiModel[];
    if (Array.isArray((asUsers as any).Users)) return (asUsers as any).Users as ManagedUserApiModel[];
    if (Array.isArray((asUsers as any).items)) return (asUsers as any).items as ManagedUserApiModel[];

    const nested = (asUsers as any).data;
    if (isObjectRecord(nested)) {
      if (Array.isArray(nested.users)) return nested.users as ManagedUserApiModel[];
      if (Array.isArray(nested.Users)) return nested.Users as ManagedUserApiModel[];
      if (Array.isArray(nested.items)) return nested.items as ManagedUserApiModel[];
    }

    return [];
  }

  const rawUsers = extractManagedUserArray(payload);

  if (!Array.isArray(rawUsers) || rawUsers.length === 0) {
    logger.warn(TAG, 'User list payload parsed as empty', {
      responseKeys: getObjectKeys(response),
      payloadKeys: getObjectKeys(payload),
      nestedDataKeys: isObjectRecord(payload) ? getObjectKeys(payload.data) : [],
      payloadType: Array.isArray(payload) ? 'array' : typeof payload,
    });
    return [];
  }

  const users = rawUsers
    .map((raw) => normalizeManagedUser(raw as ManagedUserApiModel))
    .filter((user): user is CognitoManagedUser => user !== null);

  if (users.length === 0) {
    const diagnostics = rawUsers.reduce(
      (acc, item) => {
        const raw = item as ManagedUserApiModel;
        const attributes = getNormalizedAttributes(raw);
        const hasAnyIdCandidate = Boolean(
          raw.sub ||
            raw.cognitoSub ||
            raw.cognitoUserId ||
            raw.userId ||
            raw.id ||
            raw.usernameId ||
            getSubFromAttributes(attributes),
        );
        const hasAnyEmailCandidate = Boolean(
          raw.email ||
            raw.Email ||
            getAttributeValue(attributes, 'email') ||
            getAttributeValue(attributes, 'custom:email') ||
            raw.username ||
            raw.Username,
        );

        if (hasAnyIdCandidate) acc.withIdCandidate += 1;
        if (hasAnyEmailCandidate) acc.withEmailCandidate += 1;
        acc.sampleKeys = acc.sampleKeys.length > 0 ? acc.sampleKeys : getObjectKeys(raw);
        return acc;
      },
      {
        totalRawUsers: rawUsers.length,
        withIdCandidate: 0,
        withEmailCandidate: 0,
        sampleKeys: [] as string[],
      },
    );

    logger.warn(TAG, 'All users filtered by normalization', diagnostics);
  }

  users.sort((a, b) => {
    const nameA = a.name?.trim();
    const nameB = b.name?.trim();

    if (nameA && nameB) {
      const byName = nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
      if (byName !== 0) return byName;
    }

    if (nameA && !nameB) return -1;
    if (!nameA && nameB) return 1;

    return a.email.localeCompare(b.email, 'en', { sensitivity: 'base' });
  });

  return users;
}

/** Returns the new user's Cognito sub (cognitoUserId) when the API provides it. */
export async function createCognitoUser(input: NewCognitoUserInput): Promise<string | null> {
  const response = await apiClient.post<{ cognitoUserId?: string }>('/v1/admin/usermgmt/users', {
    email: input.email.trim().toLowerCase(),
    phoneNumber: input.phoneNumber,
    name: input.name,
    roles: [...new Set(input.roles)],
  });
  const cognitoUserId = unwrapApiPayload<{ cognitoUserId?: string }>(response)?.cognitoUserId;
  return typeof cognitoUserId === 'string' && cognitoUserId.trim() ? cognitoUserId.trim() : null;
}

export async function setCognitoUserEnabled(
  cognitoUserId: string,
  enabled: boolean,
): Promise<void> {
  const userIdPathSegment = toUserIdPathSegment(cognitoUserId);
  const actionPath = enabled ? 'enable' : 'disable';

  await apiClient.post(`/v1/admin/usermgmt/users/${userIdPathSegment}/${actionPath}`, {});
}

export async function deleteCognitoUser(cognitoUserId: string): Promise<void> {
  const userIdPathSegment = toUserIdPathSegment(cognitoUserId);

  await apiClient.delete(`/v1/admin/usermgmt/users/${userIdPathSegment}`);
}

export async function updateCognitoUserProfile(
  cognitoUserId: string,
  updates: UpdateCognitoUserProfileInput,
): Promise<void> {
  const userIdPathSegment = toUserIdPathSegment(cognitoUserId);

  await apiClient.put(`/v1/admin/usermgmt/users/${userIdPathSegment}`, {
    email: updates.email,
    phoneNumber: updates.phoneNumber,
    name: updates.name,
    roles: updates.roles,
  });
}
