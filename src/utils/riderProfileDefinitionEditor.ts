import { RiderProfileAttributeDefinition } from '../types/riderProfile';

export type DefinitionGuardErrorCode =
  | 'IMMUTABLE_KEY'
  | 'IMMUTABLE_TYPE'
  | 'SYSTEM_ATTRIBUTE_PROTECTED';

export interface DefinitionGuardError {
  code: DefinitionGuardErrorCode;
  message: string;
}

export function validateAttributeDefinitionMutation(
  previous: RiderProfileAttributeDefinition,
  next: RiderProfileAttributeDefinition,
): DefinitionGuardError | null {
  if (previous.configId !== next.configId) {
    return {
      code: 'IMMUTABLE_KEY',
      message: 'Attribute key cannot be changed after creation.',
    };
  }

  if (previous.config.type !== next.config.type) {
    return {
      code: 'IMMUTABLE_TYPE',
      message: 'Attribute type cannot be changed after creation.',
    };
  }

  if (previous.config.system) {
    if (!next.enabled) {
      return {
        code: 'SYSTEM_ATTRIBUTE_PROTECTED',
        message: 'System attributes cannot be disabled.',
      };
    }

    if (previous.config.storage.scope !== next.config.storage.scope) {
      return {
        code: 'SYSTEM_ATTRIBUTE_PROTECTED',
        message: 'System attribute storage is locked.',
      };
    }

    if (previous.config.storage.scope === 'CORE' && next.config.storage.scope === 'CORE') {
      if (previous.config.storage.path !== next.config.storage.path) {
        return {
          code: 'SYSTEM_ATTRIBUTE_PROTECTED',
          message: 'System attribute storage path is locked.',
        };
      }
    }
  }

  return null;
}
