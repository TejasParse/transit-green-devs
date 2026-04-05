const {
  ECO_DESTINATION_CATEGORIES,
  listEcoDestinations,
} = require('../db/eco-destination-queries');

async function getEcoDestinations(req, res, next) {
  try {
    const category =
      typeof req.query.category === 'string' && req.query.category.trim()
        ? req.query.category.trim()
        : null;

    if (category && !ECO_DESTINATION_CATEGORIES.includes(category)) {
      throw new Error(
        `category must be one of: ${ECO_DESTINATION_CATEGORIES.join(', ')}.`
      );
    }

    const destinations = await listEcoDestinations(category);
    res.json(destinations);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getEcoDestinations,
};
