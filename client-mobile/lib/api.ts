import Constants from 'expo-constants';

import { PlantTreePayload, UserDashboard } from '@/types/dashboard';
import {
  CarpoolOverview,
  CarpoolRequestRecord,
  CarpoolRiderInput,
  CarpoolSearchResult,
  DemoProfile,
  HostedCarpoolTrip,
  LeaderboardSnapshot,
  TripPayload,
  TripRecord,
  TripStatus,
} from '@/types/trips';

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

export function fetchProfiles() {
  return request<DemoProfile[]>('/api/profiles');
}

export function fetchUserTrips(userId: number) {
  const searchParams = new URLSearchParams({ userId: String(userId) });
  return request<TripRecord[]>(`/api/trips?${searchParams.toString()}`);
}

export function fetchUserDashboard(userId: number) {
  const searchParams = new URLSearchParams({ userId: String(userId) });
  return request<UserDashboard>(`/api/dashboard?${searchParams.toString()}`);
}

export function plantForestTree(payload: PlantTreePayload) {
  return request<UserDashboard>('/api/forest/trees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createTrip(payload: TripPayload) {
  return request<TripRecord>('/api/trips', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchCarpools(userId: number) {
  const searchParams = new URLSearchParams({ userId: String(userId) });
  return request<CarpoolOverview>(`/api/carpools?${searchParams.toString()}`);
}

export function createCarpool(payload: TripPayload) {
  return request<HostedCarpoolTrip>('/api/carpools', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function searchCarpools(payload: CarpoolRiderInput) {
  return request<CarpoolSearchResult>('/api/carpools/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function requestCarpoolSeat(tripId: number, payload: CarpoolRiderInput) {
  return request<CarpoolRequestRecord>(`/api/carpools/${tripId}/requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function respondToCarpoolSeatRequest(
  tripId: number,
  requestId: number,
  payload: {
    hostId: number;
    action: 'accept' | 'decline';
  }
) {
  return request<CarpoolRequestRecord>(`/api/carpools/${tripId}/requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function updateCarpoolStatus(
  tripId: number,
  payload: {
    hostId: number;
    status: TripStatus;
    startedAt?: string | null;
    completedAt?: string | null;
    simulationSpeedMultiplier?: number | null;
  }
) {
  return request<HostedCarpoolTrip>(`/api/carpools/${tripId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
