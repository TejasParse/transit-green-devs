const { Router } = require('express');

const { patchProfile, postProfileSession } = require('../controllers/profile-controller');

const router = Router();

router.post('/api/profile/session', postProfileSession);
router.patch('/api/profile/:userId', patchProfile);

module.exports = router;
