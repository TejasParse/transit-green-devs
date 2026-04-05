const {
  createCarpool,
  createCarpoolRequest,
  getCarpoolRequestsForHost,
  getCarpoolRequestsForSender,
  listNearbyCarpools,
  respondToCarpoolRequest,
  updateCarpoolRequestProgress,
} = require('../db/carpool-queries');
const {
  validateCarpoolRequestProgressPayload,
  validateCreateCarpoolPayload,
  validateCreateCarpoolRequestPayload,
  validateListCarpoolsQuery,
  validateRespondCarpoolRequestPayload,
} = require('../validators/carpool-validator');
const { readPositiveInteger } = require('../validators/trip-validator');

async function getNearbyCarpools(req, res, next) {
  try {
    const query = validateListCarpoolsQuery(req.query);
    const result = await listNearbyCarpools(query);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function postCreateCarpool(req, res, next) {
  try {
    const payload = validateCreateCarpoolPayload(req.body);
    const createdCarpool = await createCarpool(payload);
    res.status(201).json(createdCarpool);
  } catch (error) {
    next(error);
  }
}

async function postCreateCarpoolRequest(req, res, next) {
  try {
    const payload = validateCreateCarpoolRequestPayload(req.body, req.params.carpoolId);
    const request = await createCarpoolRequest(payload);
    res.status(201).json(request);
  } catch (error) {
    next(error);
  }
}

async function getCarpoolRequests(req, res, next) {
  try {
    const userId = readPositiveInteger(req.query.userId, 'userId');
    const role =
      typeof req.query.role === 'string' && req.query.role.trim()
        ? req.query.role.trim().toLowerCase()
        : 'all';

    if (role === 'sender') {
      const senderRequests = await getCarpoolRequestsForSender(userId);
      res.json({
        sender: senderRequests,
        host: [],
      });
      return;
    }

    if (role === 'host') {
      const hostRequests = await getCarpoolRequestsForHost(userId);
      res.json({
        sender: [],
        host: hostRequests,
      });
      return;
    }

    const [senderRequests, hostRequests] = await Promise.all([
      getCarpoolRequestsForSender(userId),
      getCarpoolRequestsForHost(userId),
    ]);

    res.json({
      sender: senderRequests,
      host: hostRequests,
    });
  } catch (error) {
    next(error);
  }
}

async function postRespondCarpoolRequest(req, res, next) {
  try {
    const payload = validateRespondCarpoolRequestPayload(req.body, req.params.requestId);
    const request = await respondToCarpoolRequest(payload);
    res.json(request);
  } catch (error) {
    next(error);
  }
}

async function postCarpoolRequestProgress(req, res, next) {
  try {
    const payload = validateCarpoolRequestProgressPayload(req.body, req.params.requestId);
    const request = await updateCarpoolRequestProgress(payload);
    res.json(request);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCarpoolRequests,
  getNearbyCarpools,
  postCarpoolRequestProgress,
  postCreateCarpool,
  postCreateCarpoolRequest,
  postRespondCarpoolRequest,
};
