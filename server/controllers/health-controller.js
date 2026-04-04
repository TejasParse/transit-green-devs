const { checkDatabaseHealth } = require('../db/trip-queries');

async function getHealth(_req, res, next) {
  try {
    await checkDatabaseHealth();
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getHealth,
};
