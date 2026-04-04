import type { Coordinate } from '@/types/app';

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceBetweenCoordinates(start: Coordinate, end: Coordinate) {
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = toRadians(end.latitude - start.latitude);
  const deltaLongitude = toRadians(end.longitude - start.longitude);
  const startLatitude = toRadians(start.latitude);
  const endLatitude = toRadians(end.latitude);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2) *
      Math.cos(startLatitude) *
      Math.cos(endLatitude);

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computePolylineDistance(routePath: Coordinate[]) {
  return routePath.slice(1).reduce((distance, point, index) => {
    return distance + distanceBetweenCoordinates(routePath[index], point);
  }, 0);
}

export function getCoordinateAtDistance(routePath: Coordinate[], targetDistanceMeters: number) {
  if (routePath.length === 0) {
    return null;
  }

  if (routePath.length === 1 || targetDistanceMeters <= 0) {
    return routePath[0];
  }

  let traversedMeters = 0;

  for (let index = 1; index < routePath.length; index += 1) {
    const start = routePath[index - 1];
    const end = routePath[index];
    const segmentDistance = distanceBetweenCoordinates(start, end);

    if (traversedMeters + segmentDistance >= targetDistanceMeters) {
      const remainingDistance = targetDistanceMeters - traversedMeters;
      const ratio = segmentDistance === 0 ? 0 : remainingDistance / segmentDistance;

      return {
        latitude: start.latitude + (end.latitude - start.latitude) * ratio,
        longitude: start.longitude + (end.longitude - start.longitude) * ratio,
      };
    }

    traversedMeters += segmentDistance;
  }

  return routePath[routePath.length - 1];
}

export function formatDistanceMiles(distanceMeters: number) {
  const miles = distanceMeters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

export function formatDurationMinutes(durationSeconds: number | null | undefined) {
  const safeDuration = Math.max(0, Math.round(durationSeconds || 0));
  const hours = Math.floor(safeDuration / 3600);
  const minutes = Math.round((safeDuration % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${Math.max(1, minutes)} min`;
}

export function formatCarbonKg(carbonKg: number) {
  return `${carbonKg.toFixed(2)} kg CO2`;
}

export function formatTripDate(isoTimestamp: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoTimestamp));
}
