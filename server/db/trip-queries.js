const { pool } = require('./pool');

function mapTripRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    routeType: row.route_type,
    routeTitle: row.route_title,
    originLabel: row.origin_label,
    destinationLabel: row.destination_label,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    co2Kg: Number(row.co2_kg),
    co2SavedKg: Number(row.co2_saved_kg),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    pathPoints: row.path_points,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

async function checkDatabaseHealth() {
  await pool.query('SELECT 1');
}

async function getTripsByUserId(userId) {
  const result = await pool.query(
    `
      SELECT *
      FROM trips
      WHERE user_id = $1
      ORDER BY completed_at DESC, id DESC
    `,
    [userId]
  );

  return result.rows.map(mapTripRow);
}

async function getLeaderboardEntries() {
  const result = await pool.query(`
    SELECT
      user_id,
      MAX(display_name) AS display_name,
      COUNT(*)::INTEGER AS total_trips,
      COALESCE(SUM(distance_meters), 0)::INTEGER AS total_distance_meters,
      COALESCE(SUM(co2_kg), 0)::FLOAT8 AS total_co2_kg,
      COALESCE(SUM(co2_saved_kg), 0)::FLOAT8 AS total_co2_saved_kg,
      MAX(completed_at) AS last_trip_at
    FROM trips
    GROUP BY user_id
    ORDER BY total_co2_saved_kg DESC, total_trips DESC, last_trip_at DESC
    LIMIT 25
  `);

  return result.rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    totalTrips: row.total_trips,
    totalDistanceMeters: row.total_distance_meters,
    totalCo2Kg: Number(row.total_co2_kg),
    totalCo2SavedKg: Number(row.total_co2_saved_kg),
    lastTripAt: row.last_trip_at,
  }));
}

async function createTripRecord(trip) {
  const result = await pool.query(
    `
      INSERT INTO trips (
        user_id,
        display_name,
        route_type,
        route_title,
        origin_label,
        destination_label,
        distance_meters,
        duration_seconds,
        co2_kg,
        co2_saved_kg,
        started_at,
        completed_at,
        path_points,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13::jsonb, $14::jsonb
      )
      RETURNING *
    `,
    [
      trip.userId,
      trip.displayName,
      trip.routeType,
      trip.routeTitle,
      trip.originLabel,
      trip.destinationLabel,
      trip.distanceMeters,
      trip.durationSeconds,
      trip.co2Kg,
      trip.co2SavedKg,
      trip.startedAt,
      trip.completedAt,
      JSON.stringify(trip.pathPoints),
      JSON.stringify(trip.metadata),
    ]
  );

  return mapTripRow(result.rows[0]);
}

module.exports = {
  checkDatabaseHealth,
  createTripRecord,
  getLeaderboardEntries,
  getTripsByUserId,
};
