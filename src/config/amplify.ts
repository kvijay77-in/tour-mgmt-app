/**
 * AWS Amplify Configuration
 *
 * Configures Amplify with AppSync GraphQL API and Cognito authentication.
 * Values are sourced from environment variables defined in .env (see .env.example).
 *
 * For Expo, environment variables are exposed via app.json "extra" field and
 * accessed through expo-constants. When values are not set, the app falls back
 * to offline/mock mode.
 */

import { Amplify } from 'aws-amplify';
import Constants from 'expo-constants';

interface AmplifyEnvConfig {
  awsRegion: string;
  userPoolId: string;
  userPoolWebClientId: string;
  appSyncGraphqlEndpoint: string;
  appSyncRegion: string;
  appSyncAuthenticationType: string;
}

/**
 * Read configuration from Expo Constants (set via app.json extra field).
 * Falls back to empty strings when not configured (development / offline mode).
 */
const getEnvConfig = (): AmplifyEnvConfig => {
  const extra = Constants.expoConfig?.extra ?? {};
  return {
    awsRegion: extra.AWS_REGION ?? '',
    userPoolId: extra.AWS_USER_POOL_ID ?? '',
    userPoolWebClientId: extra.AWS_USER_POOL_WEB_CLIENT_ID ?? '',
    appSyncGraphqlEndpoint: extra.AWS_APPSYNC_GRAPHQL_ENDPOINT ?? '',
    appSyncRegion: extra.AWS_APPSYNC_REGION ?? '',
    appSyncAuthenticationType: extra.AWS_APPSYNC_AUTHENTICATION_TYPE ?? 'AMAZON_COGNITO_USER_POOLS',
  };
};

/**
 * Returns true when all required Amplify config values are present.
 */
export const isAmplifyConfigured = (): boolean => {
  const cfg = getEnvConfig();
  return !!(
    cfg.appSyncGraphqlEndpoint &&
    cfg.userPoolId &&
    cfg.userPoolWebClientId
  );
};

/**
 * Initialise Amplify. Safe to call multiple times — skips configuration when
 * environment variables are not set (local dev without backend).
 */
export const configureAmplify = (): void => {
  if (!isAmplifyConfigured()) {
    console.warn(
      '[Amplify] Configuration not found. Running in offline/mock mode. ' +
        'Set environment variables in .env and app.json extra to enable backend access.'
    );
    return;
  }

  const cfg = getEnvConfig();

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: cfg.userPoolId,
        userPoolClientId: cfg.userPoolWebClientId,
      },
    },
    API: {
      GraphQL: {
        endpoint: cfg.appSyncGraphqlEndpoint,
        region: cfg.appSyncRegion || cfg.awsRegion,
        defaultAuthMode: 'userPool',
      },
    },
  });
};
