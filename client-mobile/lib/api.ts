import Constants from 'expo-constants';

import { EcoDestination, EcoDestinationCategory } from '@/types/eco-destinations';
import { PlantTreePayload, UserDashboard } from '@/types/dashboard';
import {
  CarpoolRequestRecord,
  CarpoolSearchResponse,
  CarpoolTripRecord,
  CreateCarpoolPayload,
  CreateCarpoolRequestPayload,
  LeaderboardSnapshot,
  TripPayload,
  TripRecord,
  UpdateCarpoolPayload,
  UpdateCarpoolLiveStatusPayload,
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

export function fetchEcoDestinations(category?: EcoDestinationCategory) {
  const searchParams = new URLSearchParams();

  if (category) {
    searchParams.set('category', category);
  }

  const query = searchParams.toString();
  const path = query ? `/api/eco-destinations?${query}` : '/api/eco-destinations';

  return request<EcoDestination[]>(path);
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

export function searchCarpools(params: {
  userId: number;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  desiredDepartureTime: string;
  windowMinutes?: number;
  routeDistanceMeters: number;
}) {
  const searchParams = new URLSearchParams({
    userId: String(params.userId),
    originLat: String(params.originLat),
    originLng: String(params.originLng),
    destinationLat: String(params.destinationLat),
    destinationLng: String(params.destinationLng),
    desiredDepartureTime: params.desiredDepartureTime,
    routeDistanceMeters: String(params.routeDistanceMeters),
  });

  if (params.windowMinutes != null) {
    searchParams.set('windowMinutes', String(params.windowMinutes));
  }

  return request<CarpoolSearchResponse>(`/api/carpools/search?${searchParams.toString()}`);
}

export function createCarpool(payload: CreateCarpoolPayload) {
  return request<CarpoolTripRecord>('/api/carpools', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCarpool(payload: UpdateCarpoolPayload) {
  return request<CarpoolTripRecord>(`/api/carpools/${payload.tripId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchMyCarpools(userId: number) {
  const searchParams = new URLSearchParams({ userId: String(userId) });
  return request<CarpoolTripRecord[]>(`/api/carpools/my?${searchParams.toString()}`);
}

export function requestCarpoolSeat(tripId: number, payload: CreateCarpoolRequestPayload) {
  return request<CarpoolRequestRecord>(`/api/carpools/${tripId}/requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function postCarpoolAction<T>(path: string, userId: number) {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function acceptCarpoolRequest(tripId: number, requestId: number, userId: number) {
  return postCarpoolAction<CarpoolTripRecord>(
    `/api/carpools/${tripId}/requests/${requestId}/accept`,
    userId
  );
}

export function rejectCarpoolRequest(tripId: number, requestId: number, userId: number) {
  return postCarpoolAction<CarpoolTripRecord>(
    `/api/carpools/${tripId}/requests/${requestId}/reject`,
    userId
  );
}

export function cancelCarpoolRequest(tripId: number, requestId: number, userId: number) {
  return postCarpoolAction<CarpoolTripRecord>(
    `/api/carpools/${tripId}/requests/${requestId}/cancel`,
    userId
  );
}

export function startCarpool(tripId: number, userId: number) {
  return postCarpoolAction<CarpoolTripRecord>(`/api/carpools/${tripId}/start`, userId);
}

export function updateCarpoolLiveStatus(tripId: number, payload: UpdateCarpoolLiveStatusPayload) {
  return request<CarpoolTripRecord>(`/api/carpools/${tripId}/live-status`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function completeCarpool(tripId: number, userId: number) {
  return postCarpoolAction<CarpoolTripRecord>(`/api/carpools/${tripId}/complete`, userId);
}

export function cancelCarpool(tripId: number, userId: number) {
  return postCarpoolAction<CarpoolTripRecord>(`/api/carpools/${tripId}/cancel`, userId);
}
