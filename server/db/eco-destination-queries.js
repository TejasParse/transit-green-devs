const { pool } = require('./pool');

const ECO_DESTINATION_CATEGORIES = [
  'sustainable_ev_hubs',
  'reuse_donation_center',
  'recycling_specialized_waste_dropoff',
];

function mapDestinationRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    features: Array.isArray(row.features) ? row.features : [],
    coordinates: {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    },
  };
}

async function listEcoDestinations(category = null) {
  const result = category
    ? await pool.query(
        `
          SELECT id, name, category, address, features, latitude, longitude
          FROM eco_destinations
          WHERE category = $1
          ORDER BY name ASC
        `,
        [category]
      )
    : await pool.query(
        `
          SELECT id, name, category, address, features, latitude, longitude
          FROM eco_destinations
          ORDER BY category ASC, name ASC
        `
      );

  return result.rows.map(mapDestinationRow);
}

module.exports = {
  ECO_DESTINATION_CATEGORIES,
  listEcoDestinations,
};
