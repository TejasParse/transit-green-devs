function readRequiredString(value, fieldName, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim().slice(0, maxLength);
}

function readPositiveInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsedValue;
}

function readNonNegativeInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }

  return parsedValue;
}

function readNumber(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return parsedValue;
}

function readOptionalNumber(value, fieldName) {
  if (value == null || value === '') {
    return null;
  }

  return readNumber(value, fieldName);
}

function readOptionalString(value, maxLength = 160) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return value.trim().slice(0, maxLength);
}

function readOptionalEnum(value, fieldName, allowedValues) {
  if (value == null || value === '') {
    return null;
  }

  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}.`);
  }

  return value;
}

function readCoordinates(value, fieldName = 'coordinates') {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`${fieldName} must include valid latitude and longitude values.`);
  }

  return { latitude, longitude };
}

function readTimestamp(value, fieldName) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date string.`);
  }

  return parsed.toISOString();
}

function readPathPoints(value) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('pathPoints must contain at least two coordinates.');
  }

  return value.map((point, index) => {
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`pathPoints[${index}] must include valid latitude and longitude values.`);
    }

    return { latitude, longitude };
  });
}

function validateTripPayload(body) {
  const metadata =
    body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : {};
  const routeType = readRequiredString(body?.routeType, 'routeType', 40);
  const carpoolEnabled = body?.carpoolEnabled === true;
  const requestedMaxDetourType = readOptionalEnum(
    body?.maxDetourType,
    'maxDetourType',
    ['time', 'distance']
  );
  const maxDetourType = carpoolEnabled ? 'distance' : requestedMaxDetourType;
  const maxDetourValue = readOptionalNumber(body?.maxDetourValue, 'maxDetourValue');
  const pricePerSeatMile = readOptionalNumber(body?.pricePerSeatMile, 'pricePerSeatMile');
  const availableSeats =
    body?.availableSeats == null ? 0 : readNonNegativeInteger(body?.availableSeats, 'availableSeats');
  const simulationSpeedMultiplier = readOptionalNumber(
    body?.simulationSpeedMultiplier,
    'simulationSpeedMultiplier'
  );
  const status = readOptionalEnum(body?.status, 'status', ['scheduled', 'active', 'cancelled', 'ended']);

  if (carpoolEnabled && routeType !== 'drive') {
    throw new Error('carpoolEnabled trips must use routeType "drive".');
  }

  if (carpoolEnabled && availableSeats < 1) {
    throw new Error('Hosted carpools must offer at least one available seat.');
  }

  if (carpoolEnabled && maxDetourValue == null) {
    throw new Error('Hosted carpools must include maxDetourValue.');
  }

  if (carpoolEnabled && pricePerSeatMile == null) {
    throw new Error('Hosted carpools must include pricePerSeatMile.');
  }

  if (simulationSpeedMultiplier != null && simulationSpeedMultiplier <= 0) {
    throw new Error('simulationSpeedMultiplier must be greater than 0.');
  }

  return {
    userId: readPositiveInteger(body?.userId, 'userId'),
    displayName: readOptionalString(body?.displayName),
    routeType,
    routeTitle: readRequiredString(body?.routeTitle, 'routeTitle'),
    originLabel: readRequiredString(body?.originLabel, 'originLabel'),
    destinationLabel: readRequiredString(body?.destinationLabel, 'destinationLabel'),
    distanceMeters: Math.round(readNumber(body?.distanceMeters, 'distanceMeters')),
    durationSeconds: Math.round(readNumber(body?.durationSeconds, 'durationSeconds')),
    co2Kg: Number(readNumber(body?.co2Kg, 'co2Kg').toFixed(3)),
    co2SavedKg: Number(readNumber(body?.co2SavedKg, 'co2SavedKg').toFixed(3)),
    availableSeats,
    carpoolEnabled,
    maxDetourType,
    maxDetourValue: maxDetourValue == null ? null : Number(maxDetourValue.toFixed(2)),
    pricePerSeatMile: pricePerSeatMile == null ? null : Number(pricePerSeatMile.toFixed(2)),
    simulationSpeedMultiplier:
      simulationSpeedMultiplier == null ? 1 : Number(simulationSpeedMultiplier.toFixed(2)),
    status,
    startedAt: readTimestamp(body?.startedAt, 'startedAt'),
    completedAt: readTimestamp(body?.completedAt, 'completedAt'),
    pathPoints: readPathPoints(body?.pathPoints),
    metadata,
  };
}

module.exports = {
  readCoordinates,
  readNonNegativeInteger,
  readNumber,
  readOptionalEnum,
  readOptionalNumber,
  readPositiveInteger,
  readRequiredString,
  validateTripPayload,
};
