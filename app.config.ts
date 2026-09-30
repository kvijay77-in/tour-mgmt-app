import { ConfigContext, ExpoConfig } from 'expo/config';

const VARIANT = process.env.APP_VARIANT === 'test' ? 'test' : 'production';
const IS_TEST = VARIANT === 'test';
const BASE_ID = 'com.tourmgmt.app';
const BASE_NAME = 'Tour Mgmt';
const BASE_SCHEME = 'tour-mgmt-app';
const ID = IS_TEST ? `${BASE_ID}.dev` : BASE_ID;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  slug: config.slug ?? 'tour-mgmt-app',
  name: IS_TEST ? `${BASE_NAME} (Test)` : BASE_NAME,
  scheme: IS_TEST ? `${BASE_SCHEME}-dev` : BASE_SCHEME,
  icon: IS_TEST ? './assets/icon-test.png' : './assets/icon.png',
  ios: {
    ...config.ios,
    bundleIdentifier: ID,
  },
  android: {
    ...config.android,
    package: ID,
    adaptiveIcon: {
      ...config.android?.adaptiveIcon,
      foregroundImage: IS_TEST ? './assets/adaptive-icon-test.png' : './assets/adaptive-icon.png',
    },
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
  extra: {
    ...config.extra,
    appVariant: VARIANT,
  },
});
