const { Router } = require('express');

const { createForestTree, getDashboard } = require('../controllers/dashboard-controller');

const router = Router();

router.get('/api/dashboard', getDashboard);
router.post('/api/forest/trees', createForestTree);

module.exports = router;
