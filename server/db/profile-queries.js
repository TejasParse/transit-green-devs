const { pool } = require('./pool');

async function getProfilesForDemo() {
  const result = await pool.query(
    `
      SELECT
        profiles.id,
        profiles.user_name AS display_name,
        profiles.email,
        profiles.car_id,
        profiles.total_points::INTEGER AS total_points
      FROM profiles
      ORDER BY profiles.id ASC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    carId: row.car_id,
    hasCar: row.car_id != null,
    totalPoints: row.total_points,
  }));
}

module.exports = {
  getProfilesForDemo,
};
