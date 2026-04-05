const { Router } = require('express');

const {
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
} = require('../controllers/carpools-controller');

const router = Router();

router.get('/api/carpools/search', searchCarpools);
router.get('/api/carpools/my', getMyCarpools);
router.post('/api/carpools', postCarpool);
router.patch('/api/carpools/:tripId', patchCarpool);
router.post('/api/carpools/:tripId/requests', postCarpoolRequest);
router.post('/api/carpools/:tripId/requests/:requestId/accept', postAcceptCarpoolRequest);
router.post('/api/carpools/:tripId/requests/:requestId/reject', postRejectCarpoolRequest);
router.post('/api/carpools/:tripId/requests/:requestId/cancel', postCancelCarpoolRequest);
router.post('/api/carpools/:tripId/start', postStartCarpool);
router.post('/api/carpools/:tripId/live-status', postCarpoolLiveStatus);
router.post('/api/carpools/:tripId/complete', postCompleteCarpool);
router.post('/api/carpools/:tripId/cancel', postCancelCarpool);

module.exports = router;
