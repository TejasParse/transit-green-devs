const { readPositiveInteger, readRequiredString } = require('./trip-validator');

const REQUEST_STATUS_VALUES = new Set(['accepted', 'rejected', 'cancelled']);
const CREATE_STATUS_VALUES = new Set(['scheduled', 'active']);
const RIDE_STATUS_VALUES = new Set(['waiting_pickup', 'onboard', 'dropped_off']);

function readNonNegativeNumber(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`);
  }

  return parsedValue;
}

function readOptionalString(value, maxLength = 240) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue.slice(0, maxLength) : null;
}

function readIsoTimestamp(value, fieldName) {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date string.`);
  }

  return parsedDate.toISOString();
}

function readCoordinate(value, fieldName) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${fieldName} is required.`);
  }

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`${fieldName} must include valid latitude and longitude.`);
  }

  return { latitude, longitude };
}

function readOptionalCoordinatePair(latitudeValue, longitudeValue, fieldName) {
  if (latitudeValue == null && longitudeValue == null) {
    return null;
  }

  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`${fieldName} must include valid latitude and longitude.`);
  }

  return { latitude, longitude };
}

function readPathPoints(value) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('pathPoints must contain at least two coordinates.');
  }

  return value.map((point, index) => {
    try {
      return readCoordinate(point, `pathPoints[${index}]`);
    } catch (error) {
      throw new Error(`pathPoints[${index}] is invalid.`);
    }
  });
}

function validateListCarpoolsQuery(query) {
  return {
    userId: readPositiveInteger(query?.userId, 'userId'),
    source: readOptionalCoordinatePair(query?.sourceLat, query?.sourceLng, 'source'),
    destination: readOptionalCoordinatePair(query?.destinationLat, query?.destinationLng, 'destination'),
    sourceRadiusMeters: Math.max(
      Math.round(readNonNegativeNumber(query?.sourceRadiusMeters ?? 1200, 'sourceRadiusMeters')),
      100
    ),
    destinationRadiusMeters: Math.max(
      Math.round(readNonNegativeNumber(query?.destinationRadiusMeters ?? 1800, 'destinationRadiusMeters')),
      100
    ),
  };
}

function validateCreateCarpoolPayload(body) {
  const startsAt = readIsoTimestamp(body?.startsAt, 'startsAt');
  const durationSeconds = Math.max(
    Math.round(readNonNegativeNumber(body?.durationSeconds, 'durationSeconds')),
    60
  );
  const endsAt =
    body?.endsAt != null && body?.endsAt !== ''
      ? readIsoTimestamp(body?.endsAt, 'endsAt')
      : new Date(new Date(startsAt).getTime() + durationSeconds * 1_000).toISOString();
  const rawStatus =
    typeof body?.status === 'string' && body.status.trim() ? body.status.trim().toLowerCase() : null;
  const status =
    rawStatus && CREATE_STATUS_VALUES.has(rawStatus)
      ? rawStatus
      : new Date(startsAt).getTime() <= Date.now()
        ? 'active'
        : 'scheduled';

  if (!CREATE_STATUS_VALUES.has(status)) {
    throw new Error('status must be either "scheduled" or "active".');
  }

  const availableSeats = readPositiveInteger(body?.availableSeats, 'availableSeats');

  if (availableSeats > 6) {
    throw new Error('availableSeats must be 6 or fewer.');
  }

  return {
    hostId: readPositiveInteger(body?.userId, 'userId'),
    displayName: readOptionalString(body?.displayName, 160),
    routeTitle: readRequiredString(body?.routeTitle ?? 'Campus carpool', 'routeTitle'),
    originLabel: readRequiredString(body?.originLabel, 'originLabel'),
    destinationLabel: readRequiredString(body?.destinationLabel, 'destinationLabel'),
    distanceMeters: Math.max(
      Math.round(readNonNegativeNumber(body?.distanceMeters, 'distanceMeters')),
      100
    ),
    durationSeconds,
    availableSeats,
    startsAt,
    endsAt,
    status,
    pathPoints: readPathPoints(body?.pathPoints),
    pricePerMile: Number(readNonNegativeNumber(body?.pricePerMile, 'pricePerMile').toFixed(2)),
    maxDetourMeters: Math.max(
      Math.round(readNonNegativeNumber(body?.maxDetourMeters ?? 300, 'maxDetourMeters')),
      20
    ),
    vehicleLabel: readOptionalString(body?.vehicleLabel, 120),
    notes: readOptionalString(body?.notes, 320),
    metadata:
      body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {},
  };
}

function validateCreateCarpoolRequestPayload(body, carpoolId) {
  const statusHint = readOptionalString(body?.status, 40);
  const autoApprove =
    typeof body?.autoApprove === 'boolean'
      ? body.autoApprove
      : statusHint === 'auto'
        ? true
        : false;

  return {
    carpoolId: readPositiveInteger(carpoolId, 'carpoolId'),
    requesterId: readPositiveInteger(body?.requesterId, 'requesterId'),
    pickupLabel: readRequiredString(body?.pickupLabel, 'pickupLabel'),
    pickupPoint: readCoordinate(body?.pickupPoint, 'pickupPoint'),
    dropoffLabel: readRequiredString(body?.dropoffLabel, 'dropoffLabel'),
    dropoffPoint: readCoordinate(body?.dropoffPoint, 'dropoffPoint'),
    message: readOptionalString(body?.message, 280),
    autoApprove,
  };
}

function validateRespondCarpoolRequestPayload(body, requestId) {
  const status = readRequiredString(body?.status, 'status', 24).toLowerCase();

  if (!REQUEST_STATUS_VALUES.has(status)) {
    throw new Error('status must be one of: accepted, rejected, cancelled.');
  }

  return {
    requestId: readPositiveInteger(requestId, 'requestId'),
    hostId: readPositiveInteger(body?.hostId, 'hostId'),
    status,
    message: readOptionalString(body?.message, 280),
  };
}

function validateCarpoolRequestProgressPayload(body, requestId) {
  const rideStatus = readRequiredString(body?.rideStatus, 'rideStatus', 32).toLowerCase();

  if (!RIDE_STATUS_VALUES.has(rideStatus)) {
    throw new Error('rideStatus must be one of: waiting_pickup, onboard, dropped_off.');
  }

  return {
    requestId: readPositiveInteger(requestId, 'requestId'),
    hostId: readPositiveInteger(body?.hostId, 'hostId'),
    rideStatus,
    etaSeconds:
      body?.etaSeconds == null || body?.etaSeconds === ''
        ? null
        : Math.max(Math.round(readNonNegativeNumber(body.etaSeconds, 'etaSeconds')), 0),
  };
}

module.exports = {
  validateCreateCarpoolPayload,
  validateCreateCarpoolRequestPayload,
  validateListCarpoolsQuery,
  validateCarpoolRequestProgressPayload,
  validateRespondCarpoolRequestPayload,
};
