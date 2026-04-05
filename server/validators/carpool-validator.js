const {
  readCoordinates,
  readOptionalEnum,
  readOptionalNumber,
  readPositiveInteger,
  readRequiredString,
} = require('./trip-validator');

function validateCarpoolRiderInput(body) {
  const routeDistanceMeters = readOptionalNumber(body?.routeDistanceMeters, 'routeDistanceMeters');

  return {
    riderId: readPositiveInteger(body?.riderId, 'riderId'),
    pickupLabel: readRequiredString(body?.pickupLabel, 'pickupLabel'),
    dropoffLabel: readRequiredString(body?.dropoffLabel, 'dropoffLabel'),
    pickupPoint: readCoordinates(body?.pickupPoint, 'pickupPoint'),
    dropoffPoint: readCoordinates(body?.dropoffPoint, 'dropoffPoint'),
    routeDistanceMeters: routeDistanceMeters == null ? null : Math.round(routeDistanceMeters),
  };
}

function validateCarpoolResponsePayload(body) {
  const action = readOptionalEnum(body?.action, 'action', ['accept', 'decline']);

  if (!action) {
    throw new Error('action is required.');
  }

  return {
    hostId: readPositiveInteger(body?.hostId, 'hostId'),
    action,
  };
}

function validateCarpoolStatusPayload(body) {
  const status = readOptionalEnum(body?.status, 'status', ['scheduled', 'active', 'cancelled', 'ended']);

  if (!status) {
    throw new Error('status is required.');
  }

  const startedAt = body?.startedAt == null || body.startedAt === '' ? null : new Date(body.startedAt);
  const completedAt =
    body?.completedAt == null || body.completedAt === '' ? null : new Date(body.completedAt);

  if (startedAt && Number.isNaN(startedAt.getTime())) {
    throw new Error('startedAt must be a valid ISO date string when provided.');
  }

  if (completedAt && Number.isNaN(completedAt.getTime())) {
    throw new Error('completedAt must be a valid ISO date string when provided.');
  }

  const simulationSpeedMultiplier = readOptionalNumber(
    body?.simulationSpeedMultiplier,
    'simulationSpeedMultiplier'
  );

  if (simulationSpeedMultiplier != null && simulationSpeedMultiplier <= 0) {
    throw new Error('simulationSpeedMultiplier must be greater than 0.');
  }

  return {
    hostId: readPositiveInteger(body?.hostId, 'hostId'),
    status,
    startedAt: startedAt ? startedAt.toISOString() : null,
    completedAt: completedAt ? completedAt.toISOString() : null,
    simulationSpeedMultiplier:
      simulationSpeedMultiplier == null ? null : Number(simulationSpeedMultiplier.toFixed(2)),
  };
}

module.exports = {
  validateCarpoolResponsePayload,
  validateCarpoolRiderInput,
  validateCarpoolStatusPayload,
};
