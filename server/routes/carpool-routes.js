const { Router } = require('express');

const {
  getCarpoolRequests,
  getNearbyCarpools,
  postCarpoolRequestProgress,
  postCreateCarpool,
  postCreateCarpoolRequest,
  postRespondCarpoolRequest,
} = require('../controllers/carpools-controller');

const router = Router();

router.get('/api/carpools', getNearbyCarpools);
router.post('/api/carpools', postCreateCarpool);
router.post('/api/carpools/:carpoolId/requests', postCreateCarpoolRequest);
router.get('/api/carpool-requests', getCarpoolRequests);
router.post('/api/carpool-requests/:requestId/respond', postRespondCarpoolRequest);
router.post('/api/carpool-requests/:requestId/progress', postCarpoolRequestProgress);

module.exports = router;
