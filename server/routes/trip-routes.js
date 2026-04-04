const { Router } = require('express');

const {
  createTrip,
  getLeaderboard,
  getTrips,
} = require('../controllers/trips-controller');

const router = Router();

router.get('/api/trips', getTrips);
router.get('/api/leaderboard', getLeaderboard);
router.post('/api/trips', createTrip);

module.exports = router;
