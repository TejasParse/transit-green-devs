const { Router } = require('express');

const { getEcoDestinations } = require('../controllers/eco-destination-controller');

const router = Router();

router.get('/api/eco-destinations', getEcoDestinations);

module.exports = router;
