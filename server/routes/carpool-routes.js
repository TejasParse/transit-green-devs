const { Router } = require('express');

const {
  createCarpool,
  getCarpools,
  requestCarpoolSeat,
  respondToSeatRequest,
  searchCarpools,
  updateCarpoolStatus,
} = require('../controllers/carpool-controller');

const router = Router();

router.get('/api/carpools', getCarpools);
router.post('/api/carpools', createCarpool);
router.post('/api/carpools/search', searchCarpools);
router.post('/api/carpools/:tripId/requests', requestCarpoolSeat);
router.patch('/api/carpools/:tripId/requests/:requestId', respondToSeatRequest);
router.patch('/api/carpools/:tripId/status', updateCarpoolStatus);

module.exports = router;
