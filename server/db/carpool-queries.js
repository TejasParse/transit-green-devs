const { pool } = require('./pool');
const { createTripRecord, updateTripRecordStatus } = require('./trip-queries');

const MILES_TO_METERS = 1609.34;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(left, right) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readTripPoint(pathPoints, fallbackIndex) {
  if (!Array.isArray(pathPoints) || pathPoints.length === 0) {
    throw new Error('Carpool trip is missing route path points.');
  }

  return pathPoints[Math.max(Math.min(fallbackIndex, pathPoints.length - 1), 0)];
}

function readStoredCoordinate(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function resolveHostEndpointPoint(tripRow, key, fallbackIndex) {
  const storedPoint = readStoredCoordinate(tripRow.metadata?.[key]);

  if (storedPoint) {
    return storedPoint;
  }

  return readTripPoint(tripRow.path_points, fallbackIndex);
}

function mapHostedTripRow(row, requests = []) {
  const acceptedRidersCount = row.accepted_riders_count ?? 0;
  const pendingRequestsCount = row.pending_requests_count ?? 0;

  return {
    id: row.id,
    userId: row.user_id,
    hostDisplayName: row.host_display_name,
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
    acceptedRidersCount,
    pendingRequestsCount,
    remainingSeats: Math.max(row.available_seats - acceptedRidersCount, 0),
    requests,
  };
}

function mapCarpoolRequestRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    hostId: row.host_id,
    hostDisplayName: row.host_display_name ?? null,
    riderId: row.rider_id,
    riderDisplayName: row.rider_display_name ?? null,
    status: row.status,
    pickupLabel: row.pickup_label,
    dropoffLabel: row.dropoff_label,
    pickupPoint: row.pickup_point,
    dropoffPoint: row.dropoff_point,
    pickupDistanceMeters: row.pickup_distance_meters,
    dropoffDistanceMeters: row.dropoff_distance_meters,
    destinationGapMeters: row.destination_gap_meters,
    estimatedDetourMinutes: Number(row.estimated_detour_minutes),
    projectedPickupIndex: row.projected_pickup_index,
    projectedDropoffIndex: row.projected_dropoff_index,
    quotedPrice: Number(row.quoted_price),
    respondedAt: row.responded_at,
    createdAt: row.created_at,
    tripStatus: row.trip_status ?? null,
    routeTitle: row.route_title ?? null,
    originLabel: row.origin_label ?? null,
    destinationLabel: row.destination_label ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

function buildMatchPreview(tripRow, riderInput) {
  const pathPoints = tripRow.path_points;
  const pickupPoint = riderInput.pickupPoint;
  const dropoffPoint = riderInput.dropoffPoint;

  if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
    return null;
  }

  const hostOriginPoint = resolveHostEndpointPoint(tripRow, 'hostOriginPoint', 0);
  const hostDestinationPoint = resolveHostEndpointPoint(
    tripRow,
    'hostDestinationPoint',
    pathPoints.length - 1
  );
  const pickupToOriginMeters = haversineDistanceMeters(pickupPoint, hostOriginPoint);
  const pickupToDestinationMeters = haversineDistanceMeters(pickupPoint, hostDestinationPoint);
  const dropoffToOriginMeters = haversineDistanceMeters(dropoffPoint, hostOriginPoint);
  const dropoffToDestinationMeters = haversineDistanceMeters(dropoffPoint, hostDestinationPoint);
  const pickupDistanceMeters = Math.min(pickupToOriginMeters, pickupToDestinationMeters);
  const dropoffDistanceMeters = Math.min(dropoffToOriginMeters, dropoffToDestinationMeters);
  const radiusMeters = Number(tripRow.max_detour_value ?? 0) * MILES_TO_METERS;
  const matchesPickup = radiusMeters > 0 && pickupDistanceMeters <= radiusMeters;
  const matchesDropoff = radiusMeters > 0 && dropoffDistanceMeters <= radiusMeters;

  if (!matchesPickup && !matchesDropoff) {
    return null;
  }

  const routeDistanceMeters = Math.max(
    Number(riderInput.routeDistanceMeters ?? 0),
    haversineDistanceMeters(pickupPoint, dropoffPoint)
  );
  const quotedPrice = Number(
    (((tripRow.price_per_seat_mile ?? 0) * routeDistanceMeters) / MILES_TO_METERS).toFixed(2)
  );

  return {
    pickupDistanceMeters: Math.round(pickupDistanceMeters),
    dropoffDistanceMeters: Math.round(dropoffDistanceMeters),
    destinationGapMeters: Math.round(Math.min(pickupDistanceMeters, dropoffDistanceMeters)),
    estimatedDetourMinutes: 0,
    projectedPickupIndex: 0,
    projectedDropoffIndex: 0,
    quotedPrice,
  };
}

async function getHostedCarpoolTripById(tripId) {
  const tripResult = await pool.query(
    `
      SELECT
        trips.*,
        profiles.user_name AS host_display_name,
        COALESCE(accepted.accepted_riders_count, 0)::INTEGER AS accepted_riders_count,
        COALESCE(pending.pending_requests_count, 0)::INTEGER AS pending_requests_count
      FROM trips
      INNER JOIN profiles ON profiles.id = trips.user_id
      LEFT JOIN (
        SELECT
          trip_id,
          COUNT(*)::INTEGER AS accepted_riders_count
        FROM carpool_requests
        WHERE status = 'accepted'
        GROUP BY trip_id
      ) AS accepted ON accepted.trip_id = trips.id
      LEFT JOIN (
        SELECT
          trip_id,
          COUNT(*)::INTEGER AS pending_requests_count
        FROM carpool_requests
        WHERE status = 'pending'
        GROUP BY trip_id
      ) AS pending ON pending.trip_id = trips.id
      WHERE trips.id = $1
        AND trips.carpool_enabled = TRUE
      LIMIT 1
    `,
    [tripId]
  );

  if (tripResult.rowCount === 0) {
    throw new Error(`Hosted carpool trip ${tripId} does not exist.`);
  }

  const requestResult = await pool.query(
    `
      SELECT
        carpool_requests.*,
        host_profiles.user_name AS host_display_name,
        rider_profiles.user_name AS rider_display_name,
        trips.status AS trip_status,
        trips.route_title,
        trips.origin_label,
        trips.destination_label,
        trips.started_at,
        trips.completed_at
      FROM carpool_requests
      INNER JOIN trips ON trips.id = carpool_requests.trip_id
      INNER JOIN profiles AS host_profiles ON host_profiles.id = carpool_requests.host_id
      INNER JOIN profiles AS rider_profiles ON rider_profiles.id = carpool_requests.rider_id
      WHERE carpool_requests.trip_id = $1
      ORDER BY
        CASE carpool_requests.status
          WHEN 'pending' THEN 0
          WHEN 'accepted' THEN 1
          ELSE 2
        END,
        carpool_requests.created_at DESC
    `,
    [tripId]
  );

  return mapHostedTripRow(
    tripResult.rows[0],
    requestResult.rows.map(mapCarpoolRequestRow)
  );
}

async function createHostedCarpool(trip) {
  const savedTrip = await createTripRecord({
    ...trip,
    carpoolEnabled: true,
  });

  return getHostedCarpoolTripById(savedTrip.id);
}

async function getCarpoolOverview(userId) {
  const [hostTripsResult, riderRequestsResult] = await Promise.all([
    pool.query(
      `
        SELECT
          trips.*,
          profiles.user_name AS host_display_name,
          COALESCE(accepted.accepted_riders_count, 0)::INTEGER AS accepted_riders_count,
          COALESCE(pending.pending_requests_count, 0)::INTEGER AS pending_requests_count
        FROM trips
        INNER JOIN profiles ON profiles.id = trips.user_id
        LEFT JOIN (
          SELECT
            trip_id,
            COUNT(*)::INTEGER AS accepted_riders_count
          FROM carpool_requests
          WHERE status = 'accepted'
          GROUP BY trip_id
        ) AS accepted ON accepted.trip_id = trips.id
        LEFT JOIN (
          SELECT
            trip_id,
            COUNT(*)::INTEGER AS pending_requests_count
          FROM carpool_requests
          WHERE status = 'pending'
          GROUP BY trip_id
        ) AS pending ON pending.trip_id = trips.id
        WHERE trips.user_id = $1
          AND trips.carpool_enabled = TRUE
        ORDER BY
          CASE trips.status
            WHEN 'active' THEN 0
            WHEN 'scheduled' THEN 1
            WHEN 'ended' THEN 2
            ELSE 3
          END,
          trips.started_at ASC,
          trips.id DESC
      `,
      [userId]
    ),
    pool.query(
      `
        SELECT
          carpool_requests.*,
          host_profiles.user_name AS host_display_name,
          rider_profiles.user_name AS rider_display_name,
          trips.status AS trip_status,
          trips.route_title,
          trips.origin_label,
          trips.destination_label,
          trips.started_at,
          trips.completed_at
        FROM carpool_requests
        INNER JOIN trips ON trips.id = carpool_requests.trip_id
        INNER JOIN profiles AS host_profiles ON host_profiles.id = carpool_requests.host_id
        INNER JOIN profiles AS rider_profiles ON rider_profiles.id = carpool_requests.rider_id
        WHERE carpool_requests.rider_id = $1
        ORDER BY carpool_requests.created_at DESC
      `,
      [userId]
    ),
  ]);

  const hostTripIds = hostTripsResult.rows.map((row) => row.id);
  const requestRows =
    hostTripIds.length === 0
      ? []
      : (
          await pool.query(
            `
              SELECT
                carpool_requests.*,
                host_profiles.user_name AS host_display_name,
                rider_profiles.user_name AS rider_display_name,
                trips.status AS trip_status,
                trips.route_title,
                trips.origin_label,
                trips.destination_label,
                trips.started_at,
                trips.completed_at
              FROM carpool_requests
              INNER JOIN trips ON trips.id = carpool_requests.trip_id
              INNER JOIN profiles AS host_profiles ON host_profiles.id = carpool_requests.host_id
              INNER JOIN profiles AS rider_profiles ON rider_profiles.id = carpool_requests.rider_id
              WHERE carpool_requests.trip_id = ANY($1::int[])
              ORDER BY
                CASE carpool_requests.status
                  WHEN 'pending' THEN 0
                  WHEN 'accepted' THEN 1
                  ELSE 2
                END,
                carpool_requests.created_at DESC
            `,
            [hostTripIds]
          )
        ).rows;

  const requestsByTripId = requestRows.reduce((accumulator, row) => {
    const currentRequests = accumulator.get(row.trip_id) ?? [];
    currentRequests.push(mapCarpoolRequestRow(row));
    accumulator.set(row.trip_id, currentRequests);
    return accumulator;
  }, new Map());

  return {
    hostTrips: hostTripsResult.rows.map((row) =>
      mapHostedTripRow(row, requestsByTripId.get(row.id) ?? [])
    ),
    riderRequests: riderRequestsResult.rows.map(mapCarpoolRequestRow),
  };
}

async function searchCarpoolMatches(riderInput) {
  const result = await pool.query(
    `
      SELECT
        trips.*,
        profiles.user_name AS host_display_name,
        COALESCE(accepted.accepted_riders_count, 0)::INTEGER AS accepted_riders_count,
        COALESCE(pending.pending_requests_count, 0)::INTEGER AS pending_requests_count,
        existing_request.id AS existing_request_id,
        existing_request.status AS existing_request_status
      FROM trips
      INNER JOIN profiles ON profiles.id = trips.user_id
      LEFT JOIN (
        SELECT
          trip_id,
          COUNT(*)::INTEGER AS accepted_riders_count
        FROM carpool_requests
        WHERE status = 'accepted'
        GROUP BY trip_id
      ) AS accepted ON accepted.trip_id = trips.id
      LEFT JOIN (
        SELECT
          trip_id,
          COUNT(*)::INTEGER AS pending_requests_count
        FROM carpool_requests
        WHERE status = 'pending'
        GROUP BY trip_id
      ) AS pending ON pending.trip_id = trips.id
      LEFT JOIN LATERAL (
        SELECT id, status
        FROM carpool_requests
        WHERE trip_id = trips.id
          AND rider_id = $1
        LIMIT 1
      ) AS existing_request ON TRUE
      WHERE trips.carpool_enabled = TRUE
        AND trips.route_type = 'drive'
        AND trips.user_id <> $1
        AND trips.status = 'scheduled'
      ORDER BY
        trips.started_at ASC,
        trips.id DESC
    `,
    [riderInput.riderId]
  );

  return result.rows
    .filter((row) => row.available_seats > (row.accepted_riders_count ?? 0))
    .map((row) => {
      const match = buildMatchPreview(row, riderInput);

      if (!match) {
        return null;
      }

      return {
        tripId: row.id,
        hostId: row.user_id,
        hostDisplayName: row.host_display_name,
        routeTitle: row.route_title,
        originLabel: row.origin_label,
        destinationLabel: row.destination_label,
        distanceMeters: row.distance_meters,
        durationSeconds: row.duration_seconds,
        availableSeats: row.available_seats,
        acceptedRidersCount: row.accepted_riders_count,
        remainingSeats: Math.max(row.available_seats - row.accepted_riders_count, 0),
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        pricePerSeatMile: row.price_per_seat_mile == null ? null : Number(row.price_per_seat_mile),
        maxDetourType: row.max_detour_type,
        maxDetourValue: row.max_detour_value == null ? null : Number(row.max_detour_value),
        simulationSpeedMultiplier: Number(row.simulation_speed_multiplier ?? 1),
        pathPoints: row.path_points,
        existingRequestId: row.existing_request_id ?? null,
        existingRequestStatus: row.existing_request_status ?? null,
        ...match,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftGap = Math.min(left.pickupDistanceMeters, left.dropoffDistanceMeters);
      const rightGap = Math.min(right.pickupDistanceMeters, right.dropoffDistanceMeters);

      if (leftGap !== rightGap) {
        return leftGap - rightGap;
      }

      return new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime();
    });
}

async function getCarpoolRequestById(requestId) {
  const result = await pool.query(
    `
      SELECT
        carpool_requests.*,
        host_profiles.user_name AS host_display_name,
        rider_profiles.user_name AS rider_display_name,
        trips.status AS trip_status,
        trips.route_title,
        trips.origin_label,
        trips.destination_label,
        trips.started_at,
        trips.completed_at
      FROM carpool_requests
      INNER JOIN trips ON trips.id = carpool_requests.trip_id
      INNER JOIN profiles AS host_profiles ON host_profiles.id = carpool_requests.host_id
      INNER JOIN profiles AS rider_profiles ON rider_profiles.id = carpool_requests.rider_id
      WHERE carpool_requests.id = $1
      LIMIT 1
    `,
    [requestId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Carpool request ${requestId} does not exist.`);
  }

  return mapCarpoolRequestRow(result.rows[0]);
}

async function createCarpoolRequest(payload) {
  await pool.query('BEGIN');

  try {
    const tripResult = await pool.query(
      `
        SELECT
          trips.*
        FROM trips
        WHERE trips.id = $1
          AND trips.carpool_enabled = TRUE
        LIMIT 1
        FOR UPDATE
      `,
      [payload.tripId]
    );

    if (tripResult.rowCount === 0) {
      throw new Error(`Hosted carpool trip ${payload.tripId} does not exist.`);
    }

    const tripRow = tripResult.rows[0];
    const acceptedSeatResult = await pool.query(
      `
        SELECT COUNT(*)::INTEGER AS accepted_riders_count
        FROM carpool_requests
        WHERE trip_id = $1
          AND status = 'accepted'
      `,
      [payload.tripId]
    );
    const acceptedRidersCount = acceptedSeatResult.rows[0]?.accepted_riders_count ?? 0;

    if (tripRow.user_id === payload.riderId) {
      throw new Error('Hosts cannot request a seat in their own carpool.');
    }

    if (!['scheduled', 'active'].includes(tripRow.status)) {
      throw new Error('This hosted carpool is no longer accepting riders.');
    }

    if (tripRow.available_seats <= acceptedRidersCount) {
      throw new Error('This hosted carpool has no remaining seats.');
    }

    const existingRequestResult = await pool.query(
      `
        SELECT id, status
        FROM carpool_requests
        WHERE trip_id = $1
          AND rider_id = $2
        LIMIT 1
      `,
      [payload.tripId, payload.riderId]
    );

    if (existingRequestResult.rowCount > 0) {
      throw new Error(
        `You already have a ${existingRequestResult.rows[0].status} request for this hosted carpool.`
      );
    }

    const match = buildMatchPreview(tripRow, payload);

    if (!match) {
      throw new Error('The selected pickup and dropoff do not fit this host route.');
    }

    const insertResult = await pool.query(
      `
        INSERT INTO carpool_requests (
          trip_id,
          host_id,
          rider_id,
          status,
          pickup_label,
          dropoff_label,
          pickup_point,
          dropoff_point,
          pickup_distance_meters,
          dropoff_distance_meters,
          destination_gap_meters,
          estimated_detour_minutes,
          projected_pickup_index,
          projected_dropoff_index,
          quoted_price
        )
        VALUES (
          $1, $2, $3, 'pending', $4, $5, $6::jsonb, $7::jsonb,
          $8, $9, $10, $11, $12, $13, $14
        )
        RETURNING id
      `,
      [
        payload.tripId,
        tripRow.user_id,
        payload.riderId,
        payload.pickupLabel,
        payload.dropoffLabel,
        JSON.stringify(payload.pickupPoint),
        JSON.stringify(payload.dropoffPoint),
        match.pickupDistanceMeters,
        match.dropoffDistanceMeters,
        match.destinationGapMeters,
        match.estimatedDetourMinutes,
        match.projectedPickupIndex,
        match.projectedDropoffIndex,
        match.quotedPrice,
      ]
    );

    await pool.query('COMMIT');

    return getCarpoolRequestById(insertResult.rows[0].id);
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function respondToCarpoolRequest({ tripId, requestId, hostId, action }) {
  await pool.query('BEGIN');

  try {
    const requestResult = await pool.query(
      `
        SELECT
          carpool_requests.*,
          trips.available_seats,
          trips.user_id AS trip_host_id
        FROM carpool_requests
        INNER JOIN trips ON trips.id = carpool_requests.trip_id
        WHERE carpool_requests.id = $1
          AND carpool_requests.trip_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [requestId, tripId]
    );

    if (requestResult.rowCount === 0) {
      throw new Error(`Carpool request ${requestId} does not exist for trip ${tripId}.`);
    }

    const requestRow = requestResult.rows[0];

    if (requestRow.trip_host_id !== hostId || requestRow.host_id !== hostId) {
      throw new Error('Only the host can respond to this request.');
    }

    if (requestRow.status !== 'pending') {
      throw new Error(`This request has already been ${requestRow.status}.`);
    }

    if (action === 'accept') {
      const seatResult = await pool.query(
        `
          SELECT COUNT(*)::INTEGER AS accepted_riders_count
          FROM carpool_requests
          WHERE trip_id = $1
            AND status = 'accepted'
        `,
        [tripId]
      );

      const acceptedRidersCount = seatResult.rows[0]?.accepted_riders_count ?? 0;

      if (acceptedRidersCount >= requestRow.available_seats) {
        throw new Error('No seats remain for this hosted carpool.');
      }

      await pool.query(
        `
          INSERT INTO trip_users (trip_id, driver_id, rider_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (trip_id, rider_id) DO NOTHING
        `,
        [tripId, hostId, requestRow.rider_id]
      );
    }

    await pool.query(
      `
        UPDATE carpool_requests
        SET
          status = $3,
          responded_at = NOW()
        WHERE id = $1
          AND trip_id = $2
      `,
      [requestId, tripId, action === 'accept' ? 'accepted' : 'declined']
    );

    await pool.query('COMMIT');

    return getCarpoolRequestById(requestId);
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function updateHostedCarpoolStatus({
  tripId,
  hostId,
  status,
  startedAt = null,
  completedAt = null,
  simulationSpeedMultiplier = null,
}) {
  const updatedTrip = await updateTripRecordStatus({
    tripId,
    userId: hostId,
    status,
    startedAt,
    completedAt,
    simulationSpeedMultiplier,
  });

  if (status === 'cancelled') {
    await pool.query(
      `
        UPDATE carpool_requests
        SET
          status = 'cancelled',
          responded_at = COALESCE(responded_at, NOW())
        WHERE trip_id = $1
          AND status IN ('pending', 'accepted')
      `,
      [tripId]
    );
  }

  return getHostedCarpoolTripById(updatedTrip.id);
}

module.exports = {
  createCarpoolRequest,
  createHostedCarpool,
  getCarpoolOverview,
  getHostedCarpoolTripById,
  respondToCarpoolRequest,
  searchCarpoolMatches,
  updateHostedCarpoolStatus,
};
