const { DEFAULT_MATCHING_RADIUS_METERS } = require('../db/carpool-queries');
const CARPOOL_LIVE_STAGES = [
  'waiting_for_riders',
  'ready_to_start',
  'driver_to_pickup',
  'rider_onboard',
  'driver_to_destination',
  'completed',
  'cancelled',
];

function readRequiredString(value, fieldName, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim().slice(0, maxLength);
}

function readOptionalString(value, fieldName, maxLength = 160) {
  if (value == null || value === '') {
    return null;
  }

  return readRequiredString(value, fieldName, maxLength);
}

function readPositiveInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsedValue;
}

function readNonNegativeInteger(value, fieldName, fallback = 0) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName} must be zero or a positive integer.`);
  }

  return parsedValue;
}

function readNumber(value, fieldName, fallback = null) {
  if ((value == null || value === '') && fallback != null) {
    return fallback;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return parsedValue;
}

function readFiniteNumber(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return parsedValue;
}

function readTimestamp(value, fieldName, fallback = null) {
  const rawValue = value ?? fallback;
  const parsedValue = new Date(rawValue);

  if (Number.isNaN(parsedValue.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date string.`);
  }

  return parsedValue.toISOString();
}

function readCoordinate(value, fieldName) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`${fieldName} must include valid latitude and longitude values.`);
  }

  return { latitude, longitude };
}

function readPathPoints(value) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('pathPoints must contain at least two coordinates.');
  }

  return value.map((point, index) => readCoordinate(point, `pathPoints[${index}]`));
}

function readEnum(value, fieldName, allowedValues, fallback) {
  const nextValue = value ?? fallback;

  if (!allowedValues.includes(nextValue)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}.`);
  }

  return nextValue;
}

function validateCreateCarpoolPayload(body) {
  const durationSeconds = readPositiveInteger(body?.durationSeconds, 'durationSeconds');
  const departureTime = readTimestamp(body?.departureTime, 'departureTime');
  const estimatedArrivalTime = readTimestamp(
    body?.estimatedArrivalTime,
    'estimatedArrivalTime',
    new Date(new Date(departureTime).getTime() + durationSeconds * 1000).toISOString()
  );
  const recurrencePattern = readEnum(
    body?.recurrencePattern,
    'recurrencePattern',
    ['none', 'daily', 'weekdays'],
    'none'
  );

  return {
    userId: readPositiveInteger(body?.userId, 'userId'),
    routeTitle: readRequiredString(body?.routeTitle, 'routeTitle'),
    routeSummary: readOptionalString(body?.routeSummary, 'routeSummary', 240),
    originLabel: readRequiredString(body?.originLabel, 'originLabel'),
    destinationLabel: readRequiredString(body?.destinationLabel, 'destinationLabel'),
    distanceMeters: readPositiveInteger(body?.distanceMeters, 'distanceMeters'),
    durationSeconds,
    co2Kg: Number(readNumber(body?.co2Kg, 'co2Kg').toFixed(3)),
    availableSeats: readPositiveInteger(body?.availableSeats, 'availableSeats'),
    departureTime,
    estimatedArrivalTime,
    pickupFlexibilityMinutes: readNonNegativeInteger(
      body?.pickupFlexibilityMinutes,
      'pickupFlexibilityMinutes',
      15
    ),
    matchingRadiusMeters: readNonNegativeInteger(
      body?.matchingRadiusMeters,
      'matchingRadiusMeters',
      DEFAULT_MATCHING_RADIUS_METERS
    ),
    maxDeviationMinutes: readPositiveInteger(body?.maxDeviationMinutes, 'maxDeviationMinutes'),
    pricePerMileUsd: Number(readNumber(body?.pricePerMileUsd, 'pricePerMileUsd').toFixed(2)),
    recurrencePattern,
    recurrenceGroupKey:
      recurrencePattern === 'none'
        ? null
        : readOptionalString(body?.recurrenceGroupKey, 'recurrenceGroupKey', 120) ??
          `recurring-${Date.now()}`,
    status: readEnum(body?.status, 'status', ['draft', 'scheduled'], 'scheduled'),
    pathPoints: readPathPoints(body?.pathPoints),
    metadata:
      body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {},
  };
}

function validateSearchCarpoolsQuery(query) {
  return {
    userId: readPositiveInteger(query?.userId, 'userId'),
    origin: {
      latitude: readFiniteNumber(query?.originLat, 'originLat'),
      longitude: readFiniteNumber(query?.originLng, 'originLng'),
    },
    destination: {
      latitude: readFiniteNumber(query?.destinationLat, 'destinationLat'),
      longitude: readFiniteNumber(query?.destinationLng, 'destinationLng'),
    },
    desiredDepartureTime: readTimestamp(
      query?.desiredDepartureTime,
      'desiredDepartureTime',
      new Date().toISOString()
    ),
    windowMinutes: readNonNegativeInteger(query?.windowMinutes, 'windowMinutes', 45),
    routeDistanceMeters: readPositiveInteger(query?.routeDistanceMeters, 'routeDistanceMeters'),
  };
}

function validateCreateCarpoolRequestPayload(body) {
  return {
    userId: readPositiveInteger(body?.userId, 'userId'),
    originLabel: readRequiredString(body?.originLabel, 'originLabel'),
    destinationLabel: readRequiredString(body?.destinationLabel, 'destinationLabel'),
    pickupPoint: readCoordinate(body?.pickupPoint, 'pickupPoint'),
    dropoffPoint: readCoordinate(body?.dropoffPoint, 'dropoffPoint'),
    desiredDepartureTime: readTimestamp(body?.desiredDepartureTime, 'desiredDepartureTime'),
    estimatedDistanceMeters: readPositiveInteger(body?.estimatedDistanceMeters, 'estimatedDistanceMeters'),
    windowMinutes: readNonNegativeInteger(body?.windowMinutes, 'windowMinutes', 45),
  };
}

function validateCarpoolActionPayload(body) {
  return {
    userId: readPositiveInteger(body?.userId, 'userId'),
  };
}

function validateCarpoolLiveStatusPayload(body) {
  return {
    userId: readPositiveInteger(body?.userId, 'userId'),
    stage: readEnum(body?.stage, 'stage', CARPOOL_LIVE_STAGES),
    activeRequestId:
      body?.activeRequestId == null || body.activeRequestId === ''
        ? null
        : readPositiveInteger(body.activeRequestId, 'activeRequestId'),
    note: readOptionalString(body?.note, 'note', 240),
  };
}

module.exports = {
  validateCarpoolActionPayload,
  validateCreateCarpoolPayload,
  validateCreateCarpoolRequestPayload,
  validateCarpoolLiveStatusPayload,
  validateSearchCarpoolsQuery,
};
