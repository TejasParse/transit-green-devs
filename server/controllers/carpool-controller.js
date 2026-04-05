const {
  createCarpoolRequest,
  createHostedCarpool,
  getCarpoolOverview,
  respondToCarpoolRequest,
  searchCarpoolMatches,
  updateHostedCarpoolStatus,
} = require('../db/carpool-queries');
const { readPositiveInteger, validateTripPayload } = require('../validators/trip-validator');
const {
  validateCarpoolResponsePayload,
  validateCarpoolRiderInput,
  validateCarpoolStatusPayload,
} = require('../validators/carpool-validator');

async function getCarpools(req, res, next) {
  try {
    const userId = readPositiveInteger(req.query.userId, 'userId');
    const overview = await getCarpoolOverview(userId);
    res.json(overview);
  } catch (error) {
    next(error);
  }
}

async function createCarpool(req, res, next) {
  try {
    const payload = validateTripPayload(req.body);
    const savedCarpool = await createHostedCarpool(payload);
    res.status(201).json(savedCarpool);
  } catch (error) {
    next(error);
  }
}

async function searchCarpools(req, res, next) {
  try {
    const riderInput = validateCarpoolRiderInput(req.body);
    const matches = await searchCarpoolMatches(riderInput);
    res.json({
      pickupPoint: riderInput.pickupPoint,
      dropoffPoint: riderInput.dropoffPoint,
      matches,
    });
  } catch (error) {
    next(error);
  }
}

async function requestCarpoolSeat(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const riderInput = validateCarpoolRiderInput(req.body);
    const request = await createCarpoolRequest({
      tripId,
      ...riderInput,
    });
    res.status(201).json(request);
  } catch (error) {
    next(error);
  }
}

async function respondToSeatRequest(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const requestId = readPositiveInteger(req.params.requestId, 'requestId');
    const payload = validateCarpoolResponsePayload(req.body);
    const request = await respondToCarpoolRequest({
      tripId,
      requestId,
      ...payload,
    });
    res.json(request);
  } catch (error) {
    next(error);
  }
}

async function updateCarpoolStatus(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const payload = validateCarpoolStatusPayload(req.body);
    const trip = await updateHostedCarpoolStatus({
      tripId,
      ...payload,
    });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createCarpool,
  getCarpools,
  requestCarpoolSeat,
  respondToSeatRequest,
  searchCarpools,
  updateCarpoolStatus,
};
