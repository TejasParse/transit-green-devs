export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type RouteKind = 'walk' | 'bike' | 'transit' | 'drive';
export type TripStatus = 'scheduled' | 'active' | 'cancelled' | 'ended';
export type CarpoolDetourType = 'time' | 'distance';
export type CarpoolRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

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
  carpoolEnabled?: boolean;
  maxDetourType?: CarpoolDetourType | null;
  maxDetourValue?: number | null;
  pricePerSeatMile?: number | null;
  simulationSpeedMultiplier?: number;
  status?: TripStatus;
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

export type DemoProfile = {
  id: number;
  displayName: string;
  email: string;
  carId: number | null;
  hasCar: boolean;
  totalPoints: number;
};

export type CarpoolRequestRecord = {
  id: number;
  tripId: number;
  hostId: number;
  hostDisplayName: string | null;
  riderId: number;
  riderDisplayName: string | null;
  status: CarpoolRequestStatus;
  pickupLabel: string;
  dropoffLabel: string;
  pickupPoint: Coordinates;
  dropoffPoint: Coordinates;
  pickupDistanceMeters: number;
  dropoffDistanceMeters: number;
  destinationGapMeters: number;
  estimatedDetourMinutes: number;
  projectedPickupIndex: number;
  projectedDropoffIndex: number;
  quotedPrice: number;
  respondedAt: string | null;
  createdAt: string;
  tripStatus: TripStatus | null;
  routeTitle: string | null;
  originLabel: string | null;
  destinationLabel: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type HostedCarpoolTrip = Omit<
  TripRecord,
  'carpoolEnabled' | 'maxDetourType' | 'maxDetourValue' | 'pricePerSeatMile' | 'simulationSpeedMultiplier'
> & {
  carpoolEnabled: true;
  maxDetourType: CarpoolDetourType | null;
  maxDetourValue: number | null;
  pricePerSeatMile: number | null;
  simulationSpeedMultiplier: number;
  hostDisplayName: string;
  acceptedRidersCount: number;
  pendingRequestsCount: number;
  remainingSeats: number;
  requests: CarpoolRequestRecord[];
};

export type CarpoolOverview = {
  hostTrips: HostedCarpoolTrip[];
  riderRequests: CarpoolRequestRecord[];
};

export type CarpoolMatch = {
  tripId: number;
  hostId: number;
  hostDisplayName: string;
  routeTitle: string;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  availableSeats: number;
  acceptedRidersCount: number;
  remainingSeats: number;
  status: TripStatus;
  startedAt: string;
  completedAt: string;
  pricePerSeatMile: number | null;
  maxDetourType: CarpoolDetourType | null;
  maxDetourValue: number | null;
  simulationSpeedMultiplier: number;
  pathPoints: Coordinates[];
  existingRequestId: number | null;
  existingRequestStatus: CarpoolRequestStatus | null;
  pickupDistanceMeters: number;
  dropoffDistanceMeters: number;
  destinationGapMeters: number;
  estimatedDetourMinutes: number;
  projectedPickupIndex: number;
  projectedDropoffIndex: number;
  quotedPrice: number;
};

export type CarpoolSearchResult = {
  pickupPoint: Coordinates;
  dropoffPoint: Coordinates;
  matches: CarpoolMatch[];
};

export type CarpoolRiderInput = {
  riderId: number;
  pickupLabel: string;
  dropoffLabel: string;
  pickupPoint: Coordinates;
  dropoffPoint: Coordinates;
  routeDistanceMeters?: number | null;
};
