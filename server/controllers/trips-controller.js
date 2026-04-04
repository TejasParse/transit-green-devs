const {
  createTripRecord,
  getLeaderboardEntries,
  getTripsByUserId,
} = require('../db/trip-queries');
const { readPositiveInteger, validateTripPayload } = require('../validators/trip-validator');

async function getTrips(req, res, next) {
  try {
    const userId = readPositiveInteger(req.query.userId, 'userId');
    const trips = await getTripsByUserId(userId);
    res.json(trips);
  } catch (error) {
    next(error);
  }
}

async function getLeaderboard(_req, res, next) {
  try {
    const leaderboard = await getLeaderboardEntries();
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
