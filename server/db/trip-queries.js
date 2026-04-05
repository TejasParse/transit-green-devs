const { pool } = require('./pool');

const leaderboardAggregatesCte = `
  WITH aggregated AS (
    SELECT
      profiles.id AS user_id,
      profiles.user_name AS display_name,
      COUNT(trips.id)::INTEGER AS total_trips,
      COALESCE(SUM(trips.distance_meters), 0)::INTEGER AS total_distance_meters,
      COALESCE(SUM(trips.co2_kg), 0)::FLOAT8 AS total_co2_kg,
      COALESCE(SUM(trips.co2_saved_kg), 0)::FLOAT8 AS total_co2_saved_kg,
      MAX(trips.completed_at) AS last_trip_at
    FROM profiles
    INNER JOIN trips ON trips.user_id = profiles.id
    WHERE trips.status = 'ended'
    GROUP BY profiles.id, profiles.user_name
  )
`;

const leaderboardRankingClause = `
  , ranked AS (
    SELECT
      aggregated.*,
      ROW_NUMBER() OVER (
        ORDER BY
          aggregated.total_co2_saved_kg DESC,
          aggregated.total_trips DESC,
          aggregated.last_trip_at DESC,
          aggregated.user_id ASC
      ) AS rank,
      LAG(aggregated.total_co2_saved_kg) OVER (
        ORDER BY
          aggregated.total_co2_saved_kg DESC,
          aggregated.total_trips DESC,
          aggregated.last_trip_at DESC,
          aggregated.user_id ASC
      ) AS previous_co2_saved_kg
    FROM aggregated
  )
`;

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
    availableSeats: row.available_seats,
    carpoolEnabled: row.carpool_enabled,
    maxDetourType: row.max_detour_type,
    maxDetourValue: row.max_detour_value == null ? null : Number(row.max_detour_value),
    pricePerSeatMile: row.price_per_seat_mile == null ? null : Number(row.price_per_seat_mile),
    simulationSpeedMultiplier: Number(row.simulation_speed_multiplier ?? 1),
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    pathPoints: row.path_points,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function mapLeaderboardRow(row) {
  const totalCo2SavedKg = Number(row.total_co2_saved_kg);
  const previousCo2SavedKg =
    row.previous_co2_saved_kg == null ? null : Number(row.previous_co2_saved_kg);

  return {
    rank: row.rank,
    userId: row.user_id,
    displayName: row.display_name,
    totalTrips: row.total_trips,
    totalDistanceMeters: row.total_distance_meters,
    totalCo2Kg: Number(row.total_co2_kg),
    totalCo2SavedKg,
    co2GapToNextRankKg:
      previousCo2SavedKg == null ? null : Number((previousCo2SavedKg - totalCo2SavedKg).toFixed(3)),
    lastTripAt: row.last_trip_at,
  };
}

async function checkDatabaseHealth() {
  await pool.query('SELECT 1');
}

async function getTripsByUserId(userId) {
  const result = await pool.query(
    `
      SELECT
        trips.*,
        profiles.user_name AS display_name
      FROM trips
      INNER JOIN profiles ON profiles.id = trips.user_id
      WHERE user_id = $1
        AND trips.status = 'ended'
      ORDER BY completed_at DESC, id DESC
    `,
    [userId]
  );

  return result.rows.map(mapTripRow);
}

async function getTripRecordById(tripId, db = pool) {
  const result = await db.query(
    `
      SELECT
        trips.*,
        profiles.user_name AS display_name
      FROM trips
      INNER JOIN profiles ON profiles.id = trips.user_id
      WHERE trips.id = $1
      LIMIT 1
    `,
    [tripId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Trip ${tripId} does not exist.`);
  }

  return mapTripRow(result.rows[0]);
}

async function getLeaderboardEntries(options = {}) {
  const { userId = null, limit = 25 } = options;

  const summaryResult = await pool.query(`
    ${leaderboardAggregatesCte}
    SELECT
      COUNT(*)::INTEGER AS active_riders,
      COALESCE(SUM(total_trips), 0)::INTEGER AS total_trips,
      COALESCE(SUM(total_distance_meters), 0)::INTEGER AS total_distance_meters,
      COALESCE(SUM(total_co2_kg), 0)::FLOAT8 AS total_co2_kg,
      COALESCE(SUM(total_co2_saved_kg), 0)::FLOAT8 AS total_co2_saved_kg
    FROM aggregated
  `);

  const entriesResult = await pool.query(
    `
      ${leaderboardAggregatesCte}
      ${leaderboardRankingClause}
      SELECT
        rank,
        user_id,
        display_name,
        total_trips,
        total_distance_meters,
        total_co2_kg,
        total_co2_saved_kg,
        previous_co2_saved_kg,
        last_trip_at
      FROM ranked
      ORDER BY rank
      LIMIT $1
    `,
    [limit]
  );

  const summaryRow = summaryResult.rows[0];

  const leaderboard = {
    summary: {
      activeRiders: summaryRow.active_riders,
      totalTrips: summaryRow.total_trips,
      totalDistanceMeters: summaryRow.total_distance_meters,
      totalCo2Kg: Number(summaryRow.total_co2_kg),
      totalCo2SavedKg: Number(summaryRow.total_co2_saved_kg),
    },
    entries: entriesResult.rows.map(mapLeaderboardRow),
    currentUser: null,
  };

  if (userId != null) {
    const userResult = await pool.query(
      `
        ${leaderboardAggregatesCte}
        ${leaderboardRankingClause}
        SELECT
          rank,
          user_id,
          display_name,
          total_trips,
          total_distance_meters,
          total_co2_kg,
          total_co2_saved_kg,
          previous_co2_saved_kg,
          last_trip_at
        FROM ranked
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId]
    );

    if (userResult.rows[0]) {
      leaderboard.currentUser = mapLeaderboardRow(userResult.rows[0]);
    }
  }

  return leaderboard;
}

async function createTripRecord(trip) {
  await pool.query('BEGIN');

  try {
    const pointsToAward =
      trip.status === 'ended' || trip.status == null
        ? Math.max(Math.round(trip.co2SavedKg * 100), 0)
        : 0;
    const profileResult = await pool.query(
      `
        UPDATE profiles
        SET
          user_name = COALESCE($2, user_name),
          total_points = total_points + $3
        WHERE id = $1
        RETURNING id, user_name
      `,
      [trip.userId, trip.displayName, pointsToAward]
    );

    if (profileResult.rowCount === 0) {
      throw new Error(`Profile ${trip.userId} does not exist.`);
    }

    const result = await pool.query(
      `
        INSERT INTO trips (
          user_id,
          route_type,
          route_title,
          origin_label,
          destination_label,
          distance_meters,
          duration_seconds,
          co2_kg,
          co2_saved_kg,
          available_seats,
          carpool_enabled,
          max_detour_type,
          max_detour_value,
          price_per_seat_mile,
          simulation_speed_multiplier,
          status,
          started_at,
          completed_at,
          path_points,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19::jsonb, $20::jsonb
        )
        RETURNING *
      `,
      [
        trip.userId,
        trip.routeType,
        trip.routeTitle,
        trip.originLabel,
        trip.destinationLabel,
        trip.distanceMeters,
        trip.durationSeconds,
        trip.co2Kg,
        trip.co2SavedKg,
        trip.availableSeats ?? 0,
        trip.carpoolEnabled ?? false,
        trip.maxDetourType ?? null,
        trip.maxDetourValue ?? null,
        trip.pricePerSeatMile ?? null,
        trip.simulationSpeedMultiplier ?? 1,
        trip.status ?? 'ended',
        trip.startedAt,
        trip.completedAt,
        JSON.stringify(trip.pathPoints),
        JSON.stringify(trip.metadata),
      ]
    );

    await pool.query('COMMIT');

    return mapTripRow({
      ...result.rows[0],
      display_name: profileResult.rows[0].user_name,
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function updateTripRecordStatus({
  tripId,
  userId,
  status,
  startedAt = null,
  completedAt = null,
  simulationSpeedMultiplier = null,
}) {
  await pool.query('BEGIN');

  try {
    const currentResult = await pool.query(
      `
        SELECT
          trips.*,
          profiles.user_name AS display_name
        FROM trips
        INNER JOIN profiles ON profiles.id = trips.user_id
        WHERE trips.id = $1
          AND trips.user_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [tripId, userId]
    );

    if (currentResult.rowCount === 0) {
      throw new Error(`Trip ${tripId} does not exist for host ${userId}.`);
    }

    const currentTrip = currentResult.rows[0];
    const nextStatus = status ?? currentTrip.status;
    const result = await pool.query(
      `
        UPDATE trips
        SET
          status = $3,
          started_at = COALESCE($4, started_at),
          completed_at = COALESCE($5, completed_at),
          simulation_speed_multiplier = COALESCE($6, simulation_speed_multiplier)
        WHERE id = $1
          AND user_id = $2
        RETURNING *
      `,
      [tripId, userId, nextStatus, startedAt, completedAt, simulationSpeedMultiplier]
    );

    if (currentTrip.status !== 'ended' && nextStatus === 'ended') {
      const pointsToAward = Math.max(Math.round(Number(currentTrip.co2_saved_kg) * 100), 0);

      if (pointsToAward > 0) {
        await pool.query(
          `
            UPDATE profiles
            SET total_points = total_points + $2
            WHERE id = $1
          `,
          [userId, pointsToAward]
        );
      }
    }

    await pool.query('COMMIT');

    return mapTripRow({
      ...result.rows[0],
      display_name: currentTrip.display_name,
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

module.exports = {
  checkDatabaseHealth,
  createTripRecord,
  getTripRecordById,
  getLeaderboardEntries,
  getTripsByUserId,
  updateTripRecordStatus,
};
