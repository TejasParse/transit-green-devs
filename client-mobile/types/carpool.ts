import { Coordinates } from '@/types/trips';

export type CarpoolStatus = 'scheduled' | 'active' | 'cancelled' | 'ended';
export type CarpoolRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export type CarpoolRequestPreview = {
  id: number;
  status: CarpoolRequestStatus;
  etaSeconds: number | null;
  routeAdjustment?: Record<string, unknown>;
  createdAt: string;
  respondedAt: string | null;
};

export type CarpoolListing = {
  id: number;
  hostId: number;
  hostName: string;
  routeType: string;
  routeTitle: string;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  availableSeats: number;
  remainingSeats: number;
  acceptedCount: number;
  pendingCount: number;
  status: CarpoolStatus;
  startsAt: string;
  endsAt: string;
  sourceDistanceMeters: number | null;
  destinationDistanceMeters: number | null;
  etaToSourceSeconds: number | null;
  currentLocation: Coordinates | null;
  pathPoints: Coordinates[];
  pricePerMile: number;
  maxDetourMeters: number;
  vehicleLabel: string | null;
  notes: string | null;
  myRequest: CarpoolRequestPreview | null;
  isHostedByCurrentUser: boolean;
};

export type CarpoolDiscoveryResponse = {
  sourceRadiusMeters: number;
  destinationRadiusMeters: number;
  hosted: CarpoolListing[];
  live: CarpoolListing[];
  scheduled: CarpoolListing[];
  generatedAt: string;
};

export type CreateCarpoolPayload = {
  userId: number;
  displayName: string;
  routeTitle: string;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  availableSeats: number;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'active';
  pathPoints: Coordinates[];
  pricePerMile: number;
  maxDetourMeters: number;
  vehicleLabel?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export type CreateCarpoolRequestPayload = {
  requesterId: number;
  pickupLabel: string;
  pickupPoint: Coordinates;
  dropoffLabel: string;
  dropoffPoint: Coordinates;
  message?: string;
  autoApprove?: boolean;
};

export type CarpoolRequestRecord = {
  id: number;
  carpoolId: number;
  hostId: number;
  hostName: string;
  requesterId: number;
  requesterName: string;
  status: CarpoolRequestStatus;
  pickupLabel: string;
  pickupPoint: Coordinates | null;
  dropoffLabel: string;
  dropoffPoint: Coordinates | null;
  etaSeconds: number | null;
  routeAdjustment: Record<string, unknown>;
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  carpool: {
    id: number;
    routeTitle: string;
    originLabel: string;
    destinationLabel: string;
    status: CarpoolStatus;
    startsAt: string;
    endsAt: string;
  };
};

export type CarpoolRequestsResponse = {
  sender: CarpoolRequestRecord[];
  host: CarpoolRequestRecord[];
};

export type RespondCarpoolRequestPayload = {
  hostId: number;
  status: 'accepted' | 'rejected' | 'cancelled';
  message?: string;
};

export type CarpoolRideStatus = 'waiting_pickup' | 'onboard' | 'dropped_off';

export type UpdateCarpoolRequestProgressPayload = {
  hostId: number;
  rideStatus: CarpoolRideStatus;
  etaSeconds?: number;
};
