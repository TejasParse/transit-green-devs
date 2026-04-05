export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type RouteKind = 'walk' | 'bike' | 'transit' | 'carpool' | 'drive';
export type TripStatus =
  | 'draft'
  | 'scheduled'
  | 'confirmed'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'ended';
export type CarpoolRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled_by_rider'
  | 'expired';
export type CarpoolRecurrencePattern = 'none' | 'daily' | 'weekdays';
export type CarpoolLiveStage =
  | 'waiting_for_riders'
  | 'ready_to_start'
  | 'driver_to_pickup'
  | 'rider_onboard'
  | 'driver_to_destination'
  | 'completed'
  | 'cancelled';

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
  seatCapacity?: number;
  status?: TripStatus;
  startedAt: string;
  completedAt: string;
  pathPoints: Coordinates[];
  metadata?: Record<string, unknown>;
};

export type TripRecord = TripPayload & {
  id: number;
  participantRole?: 'driver' | 'rider' | null;
  createdAt: string;
};

export type CarpoolTrustSignals = {
  ratingAverage: number;
  ratingCount: number;
  ridesCompleted: number;
  ridersHelped: number;
  cancellationCount: number;
  blocked: boolean;
};

export type CarpoolParticipant = {
  userId: number;
  displayName: string;
  role: 'driver' | 'rider';
  joinedAt: string;
  leftAt: string | null;
};

export type CarpoolLiveStatus = {
  stage: CarpoolLiveStage;
  activeRequestId: number | null;
  activeRiderId: number | null;
  activeRiderName: string | null;
  note: string | null;
  updatedAt: string;
};

export type CarpoolRequestRecord = {
  id: number;
  tripId: number;
  driverId: number;
  riderId: number;
  riderName: string | null;
  status: CarpoolRequestStatus;
  riderOriginLabel: string;
  riderDestinationLabel: string;
  pickupPoint: Coordinates | null;
  dropoffPoint: Coordinates | null;
  requestedDepartureTime: string;
  estimatedDistanceMeters: number;
  estimatedAddedMinutes: number;
  estimatedPriceUsd: number;
  decisionNote: string | null;
  expiresAt: string | null;
  respondedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CarpoolTripRecord = {
  id: number;
  userId: number;
  driverId: number;
  driverName: string;
  routeType: 'carpool';
  routeTitle: string;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  co2Kg: number;
  co2SavedKg: number;
  availableSeats: number;
  seatCapacity: number;
  pickupFlexibilityMinutes: number;
  matchingRadiusMeters: number;
  maxDeviationMinutes: number;
  pricePerMileUsd: number;
  recurrencePattern: CarpoolRecurrencePattern;
  recurrenceGroupKey: string | null;
  status: TripStatus;
  departureTime: string;
  estimatedArrivalTime: string;
  startedAt: string;
  completedAt: string;
  pathPoints: Coordinates[];
  metadata: Record<string, unknown>;
  createdAt: string;
  participantCount: number;
  ridersHelped: number;
  acceptedRiders: number;
  pendingRequestCount: number;
  car: {
    make: string;
    model: string;
    capacity: number;
  } | null;
  trustSignals: CarpoolTrustSignals;
  currentUserRequest: {
    id: number;
    status: CarpoolRequestStatus;
    estimatedAddedMinutes: number;
    estimatedPriceUsd: number | null;
    requestedDepartureTime: string;
  } | null;
  currentUserRole?: 'driver' | 'rider';
  canManageRequests?: boolean;
  requests?: CarpoolRequestRecord[];
  participants?: CarpoolParticipant[];
  carpoolImpactMultiplier?: number;
  liveStatus?: CarpoolLiveStatus | null;
};

export type CarpoolSearchMatch = CarpoolTripRecord & {
  pickupDistanceMeters: number;
  dropoffDistanceMeters: number;
  estimatedAddedMinutes: number;
  departureDifferenceMinutes: number;
  estimatedPriceUsd: number;
  estimatedDistanceMeters: number;
  estimatedCo2SavedKg: number;
};

export type CarpoolSearchResponse = {
  matches: CarpoolSearchMatch[];
  suggestion: string | null;
};

export type CreateCarpoolPayload = {
  userId: number;
  routeTitle: string;
  routeSummary?: string | null;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  co2Kg: number;
  availableSeats: number;
  departureTime: string;
  estimatedArrivalTime?: string;
  pickupFlexibilityMinutes: number;
  matchingRadiusMeters: number;
  maxDeviationMinutes: number;
  pricePerMileUsd: number;
  recurrencePattern: CarpoolRecurrencePattern;
  recurrenceGroupKey?: string | null;
  status?: 'draft' | 'scheduled';
  pathPoints: Coordinates[];
  metadata?: Record<string, unknown>;
};

export type UpdateCarpoolPayload = CreateCarpoolPayload & {
  tripId: number;
};

export type UpdateCarpoolLiveStatusPayload = {
  userId: number;
  stage: CarpoolLiveStage;
  activeRequestId?: number | null;
  note?: string | null;
};

export type CreateCarpoolRequestPayload = {
  userId: number;
  originLabel: string;
  destinationLabel: string;
  pickupPoint: Coordinates;
  dropoffPoint: Coordinates;
  desiredDepartureTime: string;
  estimatedDistanceMeters: number;
  windowMinutes?: number;
};

export type LeaderboardEntry = {
  rank: number;
  userId: number;
  displayName: string;
  totalTrips: number;
  totalDistanceMeters: number;
  totalCo2Kg: number;
  totalCo2SavedKg: number;
  completedCarpools: number;
  ridersHelped: number;
  totalCarpoolCo2SavedKg: number;
  co2GapToNextRankKg: number | null;
  lastTripAt: string | null;
};

export type LeaderboardSummary = {
  activeRiders: number;
  totalTrips: number;
  totalDistanceMeters: number;
  totalCo2Kg: number;
  totalCo2SavedKg: number;
  completedCarpools: number;
  liveCarpools: number;
  totalSharedRides: number;
  totalRidersHelped: number;
  totalCarpoolCo2SavedKg: number;
};

export type EcoDriverEntry = {
  userId: number;
  displayName: string;
  ridersHelped: number;
  totalCarpoolCo2SavedKg: number;
  completedCarpools: number;
};

export type LeaderboardSnapshot = {
  summary: LeaderboardSummary;
  entries: LeaderboardEntry[];
  ecoDrivers: EcoDriverEntry[];
  currentUser: LeaderboardEntry | null;
};
