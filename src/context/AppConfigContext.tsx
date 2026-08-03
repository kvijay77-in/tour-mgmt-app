import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CONFIG_TYPE } from '../constants/idCodes';
import { useAuth } from './AuthContext';
import { listAppConfigs } from '../services/api/configApi';
import { getEnabledIdCodeFormat, getIdCodeTypeMap, upsertAppConfigs } from '../services/database/appConfigStore';
import { logger } from '../utils/logger';

const TAG = 'AppConfigContext';

interface AppConfigContextValue {
  isReady: boolean;
  isUsingDefaults: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const AppConfigContext = createContext<AppConfigContextValue>({
  isReady: false,
  isUsingDefaults: true,
  error: null,
  refresh: async () => {},
});

export function useAppConfig(): AppConfigContextValue {
  return useContext(AppConfigContext);
}

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [isUsingDefaults, setIsUsingDefaults] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setIsReady(false);

    try {
      const items = await listAppConfigs([CONFIG_TYPE.ID_CODE_FORMAT, CONFIG_TYPE.ID_CODE_TYPE]);
      if (items.length > 0) {
        await upsertAppConfigs(items);
      }

      const [format, typeMap] = await Promise.all([
        getEnabledIdCodeFormat(),
        getIdCodeTypeMap(),
      ]);

      if (!format) {
        throw new Error(`Missing mandatory Config - ${CONFIG_TYPE.ID_CODE_FORMAT}`);
      }

      if (Object.keys(typeMap).length === 0) {
        throw new Error(`Missing mandatory Config - ${CONFIG_TYPE.ID_CODE_TYPE}`);
      }

      setIsUsingDefaults(false);
      setIsReady(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load app configuration.';
      logger.error(TAG, 'App configuration initialization failed.', err);
      setIsUsingDefaults(false);
      setIsReady(false);
      setError(message);
    }
  }, []);

  useEffect(() => {
    if (!user?.userId) {
      setIsReady(false);
      setIsUsingDefaults(false);
      setError(null);
      return;
    }

    void refresh();
  }, [user?.userId, refresh]);

  const value = useMemo<AppConfigContextValue>(() => ({
    isReady,
    isUsingDefaults,
    error,
    refresh,
  }), [isReady, isUsingDefaults, error, refresh]);

  if (error && !isReady) {
    throw new Error(error);
  }

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}
