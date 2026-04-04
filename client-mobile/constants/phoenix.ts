import type { Coordinate } from '@/types/app';

export const GREATER_PHOENIX_BOUNDS = {
  north: 33.95,
  south: 32.95,
  east: -111.25,
  west: -112.75,
};

export const DOWNTOWN_PHOENIX: Coordinate = {
  latitude: 33.4484,
  longitude: -112.074,
};

export const GREATER_PHOENIX_REGION = {
  latitude: 33.4484,
  longitude: -112.074,
  latitudeDelta: 0.92,
  longitudeDelta: 0.92,
};

export function isWithinPhoenix(coordinate: Coordinate) {
  return (
    coordinate.latitude >= GREATER_PHOENIX_BOUNDS.south &&
    coordinate.latitude <= GREATER_PHOENIX_BOUNDS.north &&
    coordinate.longitude >= GREATER_PHOENIX_BOUNDS.west &&
    coordinate.longitude <= GREATER_PHOENIX_BOUNDS.east
  );
}
