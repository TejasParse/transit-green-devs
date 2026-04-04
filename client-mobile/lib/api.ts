import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { Coordinate, PlaceDetails, PlaceSuggestion, PlannedRoute, TripRecord } from '@/types/app';

type ApiErrorPayload = {
  error?: string;
};

type ExpoConfigWithHostUri = {
  hostUri?: string;
};

function resolveApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  const hostUri = (Constants.expoConfig as ExpoConfigWithHostUri | null)?.hostUri;
  if (hostUri) {
    const [host] = hostUri.split(':');
    return `http://${host}:4000`;
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:4000';
  }

  return 'http://localhost:4000';
}

export const API_BASE_URL = resolveApiBaseUrl();

async function apiRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  const payload = (await response.json().catch(() => null)) as T | ApiErrorPayload | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && payload.error
        ? payload.error
        : 'The request failed.';
    throw new Error(message);
  }

  return payload as T;
}

export const api = {
  autocompletePlaces(query: string) {
    return apiRequest<{ suggestions: PlaceSuggestion[] }>(
      `/api/places/autocomplete?q=${encodeURIComponent(query)}`
    );
  },
  getPlaceDetails(placeId: string) {
    return apiRequest<PlaceDetails>(`/api/places/${encodeURIComponent(placeId)}`);
  },
  planRoute(origin: Coordinate, destination: Coordinate) {
    return apiRequest<{ route: PlannedRoute; routeFallback?: string }>('/api/routes/plan', {
      method: 'POST',
      body: JSON.stringify({ origin, destination }),
    });
  },
  createTrip(payload: {
    originName: string;
    origin: Coordinate;
    destinationName: string;
    destination: Coordinate;
    routeKind: PlannedRoute['routeKind'];
    routeLabels: string[];
    routePath: Coordinate[];
    distanceMeters: number;
    durationSeconds: number;
    estimatedCarbonKg: number;
    fuelConsumptionLiters: number | null;
    startedAt: string;
  }) {
    return apiRequest<{ trip: TripRecord }>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  completeTrip(tripId: number, payload: { endedAt: string; actualDurationSeconds: number }) {
    return apiRequest<{ trip: TripRecord }>(`/api/trips/${tripId}/complete`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  getTrips() {
    return apiRequest<{ trips: TripRecord[] }>('/api/trips');
  },
};
