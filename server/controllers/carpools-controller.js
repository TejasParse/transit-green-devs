const {
  acceptCarpoolRequest,
  cancelCarpoolRequest,
  cancelCarpoolTrip,
  completeCarpoolTrip,
  createCarpoolRequest,
  createCarpoolTrip,
  listMyCarpools,
  rejectCarpoolRequest,
  searchAvailableCarpools,
  startCarpoolTrip,
  updateCarpoolTrip,
  updateCarpoolLiveStatus,
} = require('../db/carpool-queries');
const {
  validateCarpoolActionPayload,
  validateCreateCarpoolPayload,
  validateCreateCarpoolRequestPayload,
  validateCarpoolLiveStatusPayload,
  validateSearchCarpoolsQuery,
} = require('../validators/carpool-validator');
const { readPositiveInteger } = require('../validators/trip-validator');

async function searchCarpools(req, res, next) {
  try {
    const filters = validateSearchCarpoolsQuery(req.query);
    const results = await searchAvailableCarpools(filters);
    res.json(results);
  } catch (error) {
    next(error);
  }
}

async function getMyCarpools(req, res, next) {
  try {
    const userId = readPositiveInteger(req.query.userId, 'userId');
    const carpools = await listMyCarpools(userId);
    res.json(carpools);
  } catch (error) {
    next(error);
  }
}

async function postCarpool(req, res, next) {
  try {
    const payload = validateCreateCarpoolPayload(req.body);
    const savedTrip = await createCarpoolTrip(payload);
    res.status(201).json(savedTrip);
  } catch (error) {
    next(error);
  }
}

async function patchCarpool(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const payload = validateCreateCarpoolPayload(req.body);
    const savedTrip = await updateCarpoolTrip({ tripId, ...payload });
    res.json(savedTrip);
  } catch (error) {
    next(error);
  }
}

async function postCarpoolRequest(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const payload = validateCreateCarpoolRequestPayload(req.body);
    const savedRequest = await createCarpoolRequest({ ...payload, tripId });
    res.status(201).json(savedRequest);
  } catch (error) {
    next(error);
  }
}

async function postAcceptCarpoolRequest(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const requestId = readPositiveInteger(req.params.requestId, 'requestId');
    const payload = validateCarpoolActionPayload(req.body);
    const trip = await acceptCarpoolRequest({ tripId, requestId, userId: payload.userId });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

async function postRejectCarpoolRequest(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const requestId = readPositiveInteger(req.params.requestId, 'requestId');
    const payload = validateCarpoolActionPayload(req.body);
    const trip = await rejectCarpoolRequest({ tripId, requestId, userId: payload.userId });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

async function postCancelCarpoolRequest(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const requestId = readPositiveInteger(req.params.requestId, 'requestId');
    const payload = validateCarpoolActionPayload(req.body);
    const trip = await cancelCarpoolRequest({ tripId, requestId, userId: payload.userId });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

async function postStartCarpool(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const payload = validateCarpoolActionPayload(req.body);
    const trip = await startCarpoolTrip({ tripId, userId: payload.userId });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

async function postCompleteCarpool(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const payload = validateCarpoolActionPayload(req.body);
    const trip = await completeCarpoolTrip({ tripId, userId: payload.userId });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

async function postCarpoolLiveStatus(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const payload = validateCarpoolLiveStatusPayload(req.body);
    const trip = await updateCarpoolLiveStatus({ tripId, ...payload });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

async function postCancelCarpool(req, res, next) {
  try {
    const tripId = readPositiveInteger(req.params.tripId, 'tripId');
    const payload = validateCarpoolActionPayload(req.body);
    const trip = await cancelCarpoolTrip({ tripId, userId: payload.userId });
    res.json(trip);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMyCarpools,
  patchCarpool,
  postAcceptCarpoolRequest,
  postCancelCarpool,
  postCancelCarpoolRequest,
  postCarpool,
  postCarpoolLiveStatus,
  postCarpoolRequest,
  postCompleteCarpool,
  postRejectCarpoolRequest,
  postStartCarpool,
  searchCarpools,
};
