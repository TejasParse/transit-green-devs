import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';
import path from 'node:path';

const appJson = require('./app.json');

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? '';
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? '';
const auth0Domain = process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? '';
const auth0ClientId = process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? '';
const auth0Audience = process.env.EXPO_PUBLIC_AUTH0_AUDIENCE ?? '';
const auth0Connection = process.env.EXPO_PUBLIC_AUTH0_CONNECTION ?? '';

const expoConfig = appJson.expo as ExpoConfig;

export default (): ExpoConfig => ({
  ...expoConfig,
  extra: {
    ...(expoConfig.extra ?? {}),
    googleMapsApiKey,
    apiBaseUrl,
    auth0Domain,
    auth0ClientId,
    auth0Audience,
    auth0Connection,
  },
  android: {
    ...expoConfig.android,
    config: googleMapsApiKey
      ? {
          ...(expoConfig.android?.config ?? {}),
          googleMaps: {
            apiKey: googleMapsApiKey,
          },
        }
      : expoConfig.android?.config,
  },
  ios: {
    ...expoConfig.ios,
    config: googleMapsApiKey
      ? {
          ...(expoConfig.ios?.config ?? {}),
          googleMapsApiKey,
        }
      : expoConfig.ios?.config,
  },
});
