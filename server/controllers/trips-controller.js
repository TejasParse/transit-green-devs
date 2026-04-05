const {
  createTripRecord,
  getLeaderboardEntries,
  getTripsByUserId,
} = require('../db/trip-queries');
const { readPositiveInteger, validateTripPayload } = require('../validators/trip-validator');

function readOptionalPositiveInteger(value, fieldName) {
  if (value == null || value === '') {
    return null;
  }

  return readPositiveInteger(value, fieldName);
}

async function getTrips(req, res, next) {
  try {
    const userId = readPositiveInteger(req.query.userId, 'userId');
    const trips = await getTripsByUserId(userId);
    res.json(trips);
  } catch (error) {
    next(error);
  }
}

async function getLeaderboard(req, res, next) {
  try {
    const userId = readOptionalPositiveInteger(req.query.userId, 'userId');
    const requestedLimit = readOptionalPositiveInteger(req.query.limit, 'limit');
    const limit = requestedLimit == null ? 25 : Math.min(requestedLimit, 100);
    const leaderboard = await getLeaderboardEntries({ userId, limit });
    res.json(leaderboard);
  } catch (error) {
    next(error);
  }
}

async function createTrip(req, res, next) {
  try {
    const trip = validateTripPayload(req.body);
    const savedTrip = await createTripRecord(trip);
    res.status(201).json(savedTrip);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createTrip,
  getLeaderboard,
  getTrips,
};
