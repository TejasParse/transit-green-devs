const { resolveProfileSession, updateProfileDetails } = require('../db/profile-queries');
const {
  validateProfileSessionPayload,
  validateProfileUpdatePayload,
} = require('../validators/profile-validator');
const { readPositiveInteger } = require('../validators/trip-validator');

async function postProfileSession(req, res, next) {
  try {
    const payload = validateProfileSessionPayload(req.body);
    const session = await resolveProfileSession(payload);
    res.status(session.needsProfileCompletion ? 202 : 200).json(session);
  } catch (error) {
    next(error);
  }
}

async function patchProfile(req, res, next) {
  try {
    const userId = readPositiveInteger(req.params.userId, 'userId');
    const payload = validateProfileUpdatePayload(req.body);
    const profile = await updateProfileDetails({ userId, ...payload });
    res.json(profile);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  patchProfile,
  postProfileSession,
};
