import Constants from 'expo-constants';

import {
  CarpoolDiscoveryResponse,
  CarpoolListing,
  CarpoolRequestRecord,
  CarpoolRequestsResponse,
  CreateCarpoolPayload,
  CreateCarpoolRequestPayload,
  RespondCarpoolRequestPayload,
  UpdateCarpoolRequestProgressPayload,
} from '@/types/carpool';
import { PlantTreePayload, UserDashboard } from '@/types/dashboard';
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

type FetchNearbyCarpoolsParams = {
  userId: number;
  source?: { latitude: number; longitude: number } | null;
  destination?: { latitude: number; longitude: number } | null;
  sourceRadiusMeters?: number;
  destinationRadiusMeters?: number;
};

export function fetchNearbyCarpools(params: FetchNearbyCarpoolsParams) {
  const searchParams = new URLSearchParams({
    userId: String(params.userId),
  });

  if (params.source) {
    searchParams.set('sourceLat', String(params.source.latitude));
    searchParams.set('sourceLng', String(params.source.longitude));
  }

  if (params.destination) {
    searchParams.set('destinationLat', String(params.destination.latitude));
    searchParams.set('destinationLng', String(params.destination.longitude));
  }

  if (params.sourceRadiusMeters != null) {
    searchParams.set('sourceRadiusMeters', String(params.sourceRadiusMeters));
  }

  if (params.destinationRadiusMeters != null) {
    searchParams.set('destinationRadiusMeters', String(params.destinationRadiusMeters));
  }

  return request<CarpoolDiscoveryResponse>(`/api/carpools?${searchParams.toString()}`);
}

export function fetchCarpoolRequests(userId: number, role: 'all' | 'sender' | 'host' = 'all') {
  const searchParams = new URLSearchParams({
    userId: String(userId),
    role,
  });

  return request<CarpoolRequestsResponse>(`/api/carpool-requests?${searchParams.toString()}`);
}

export function createCarpool(payload: CreateCarpoolPayload) {
  return request<CarpoolListing>('/api/carpools', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function requestCarpoolSeat(carpoolId: number, payload: CreateCarpoolRequestPayload) {
  return request<CarpoolRequestRecord>(`/api/carpools/${carpoolId}/requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function respondToCarpoolRequest(requestId: number, payload: RespondCarpoolRequestPayload) {
  return request<CarpoolRequestRecord>(`/api/carpool-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCarpoolRequestProgress(
  requestId: number,
  payload: UpdateCarpoolRequestProgressPayload
) {
  return request<CarpoolRequestRecord>(`/api/carpool-requests/${requestId}/progress`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
