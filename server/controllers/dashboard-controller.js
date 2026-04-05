const { getUserDashboard, plantForestTree } = require('../db/dashboard-queries');
const { readPositiveInteger } = require('../validators/trip-validator');
const { validatePlantTreePayload } = require('../validators/forest-validator');

async function getDashboard(req, res, next) {
  try {
    const userId = readPositiveInteger(req.query.userId, 'userId');
    const dashboard = await getUserDashboard(userId);
    res.json(dashboard);
  } catch (error) {
    next(error);
  }
}

async function createForestTree(req, res, next) {
  try {
    const payload = validatePlantTreePayload(req.body);
    const dashboard = await plantForestTree(payload);
    res.status(201).json(dashboard);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createForestTree,
  getDashboard,
};
