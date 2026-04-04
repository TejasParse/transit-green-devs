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

function readNumber(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return parsedValue;
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

  return {
    userId: readPositiveInteger(body?.userId, 'userId'),
    displayName:
      typeof body?.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim().slice(0, 160)
        : null,
    routeType: readRequiredString(body?.routeType, 'routeType', 40),
    routeTitle: readRequiredString(body?.routeTitle, 'routeTitle'),
    originLabel: readRequiredString(body?.originLabel, 'originLabel'),
    destinationLabel: readRequiredString(body?.destinationLabel, 'destinationLabel'),
    distanceMeters: Math.round(readNumber(body?.distanceMeters, 'distanceMeters')),
    durationSeconds: Math.round(readNumber(body?.durationSeconds, 'durationSeconds')),
    co2Kg: Number(readNumber(body?.co2Kg, 'co2Kg').toFixed(3)),
    co2SavedKg: Number(readNumber(body?.co2SavedKg, 'co2SavedKg').toFixed(3)),
    startedAt: readTimestamp(body?.startedAt, 'startedAt'),
    completedAt: readTimestamp(body?.completedAt, 'completedAt'),
    pathPoints: readPathPoints(body?.pathPoints),
    metadata,
  };
}

module.exports = {
  readPositiveInteger,
  readRequiredString,
  validateTripPayload,
};
