const { Router } = require('express');

const { getProfiles } = require('../controllers/profiles-controller');

const router = Router();

router.get('/api/profiles', getProfiles);

module.exports = router;
