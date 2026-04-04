export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type PlaceSuggestion = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
};

export type PlaceDetails = {
  placeId: string;
  name: string;
  address: string;
  coordinate: Coordinate;
};

export type PlannedRoute = {
  origin: Coordinate;
  destination: Coordinate;
  routeKind: 'eco' | 'best-available';
  routeLabels: string[];
  routePath: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  estimatedCarbonKg: number;
  fuelConsumptionLiters: number | null;
};

export type TripRecord = {
  id: number;
  status: 'in_progress' | 'completed';
  originName: string;
  origin: Coordinate;
  destinationName: string;
  destination: Coordinate;
  routeKind: 'eco' | 'best-available';
  routeLabels: string[];
  routePath: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  actualDurationSeconds: number | null;
  estimatedCarbonKg: number;
  fuelConsumptionLiters: number | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
