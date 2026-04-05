import Constants from 'expo-constants';

import { LeaderboardSnapshot, TripPayload, TripRecord } from '@/types/trips';

type ExpoConstantsShape = {
  expoConfig?: {
    hostUri?: string;
    extra?: {
      apiBaseUrl?: string;
    };
  } | null;
  expoGoConfig?: {
    debuggerHost?: string;
  } | null;
};

const constants = Constants as unknown as ExpoConstantsShape;

function resolveApiBaseUrl() {
  const configuredBaseUrl =
    constants.expoConfig?.extra?.apiBaseUrl?.trim() ?? process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const hostUri = constants.expoConfig?.hostUri ?? constants.expoGoConfig?.debuggerHost ?? '';
  const host = hostUri.split(':')[0];

  if (host) {
    return `http://${host}:3001`;
  }

  return 'http://localhost:3001';
}

export const API_BASE_URL = resolveApiBaseUrl();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function fetchLeaderboard(userId?: number) {
  const searchParams = new URLSearchParams();

  if (userId != null) {
    searchParams.set('userId', String(userId));
  }

  const query = searchParams.toString();
  const path = query ? `/api/leaderboard?${query}` : '/api/leaderboard';

  return request<LeaderboardSnapshot>(path);
}

export function fetchUserTrips(userId: number) {
  const searchParams = new URLSearchParams({ userId: String(userId) });
  return request<TripRecord[]>(`/api/trips?${searchParams.toString()}`);
}

export function createTrip(payload: TripPayload) {
  return request<TripRecord>('/api/trips', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
