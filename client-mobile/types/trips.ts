export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type RouteKind = 'walk' | 'bike' | 'transit' | 'drive';

export type WaypointInput =
  | {
      type: 'coordinates';
      coordinates: Coordinates;
    }
  | {
      type: 'placeId';
      placeId: string;
    }
  | {
      type: 'address';
      address: string;
    };

export type AddressSuggestion = {
  id: string;
  placeId: string;
  placeResourceName?: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
  distanceMeters?: number;
};

export type RouteOption = {
  id: string;
  kind: RouteKind;
  title: string;
  subtitle: string;
  summary: string;
  distanceMeters: number;
  durationSeconds: number;
  co2Kg: number;
  co2SavedKg: number;
  polyline: Coordinates[];
  start: Coordinates;
  end: Coordinates;
  color: string;
  badges: string[];
  warnings: string[];
};

export type RoutePlan = {
  originLabel: string;
  destinationLabel: string;
  origin: Coordinates;
  destination: Coordinates;
  baselineDriveCo2Kg: number;
  generatedAt: string;
  notices: string[];
  options: RouteOption[];
};

export type TripPayload = {
  userId: number;
  displayName: string;
  routeType: RouteKind;
  routeTitle: string;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  co2Kg: number;
  co2SavedKg: number;
  availableSeats?: number;
  status?: 'scheduled' | 'active' | 'cancelled' | 'ended';
  startedAt: string;
  completedAt: string;
  pathPoints: Coordinates[];
  metadata?: Record<string, unknown>;
};

export type TripRecord = TripPayload & {
  id: number;
  createdAt: string;
};

export type LeaderboardEntry = {
  rank: number;
  userId: number;
  displayName: string;
  totalTrips: number;
  totalDistanceMeters: number;
  totalCo2Kg: number;
  totalCo2SavedKg: number;
  co2GapToNextRankKg: number | null;
  lastTripAt: string | null;
};

export type LeaderboardSummary = {
  activeRiders: number;
  totalTrips: number;
  totalDistanceMeters: number;
  totalCo2Kg: number;
  totalCo2SavedKg: number;
};

export type LeaderboardSnapshot = {
  summary: LeaderboardSummary;
  entries: LeaderboardEntry[];
  currentUser: LeaderboardEntry | null;
};
