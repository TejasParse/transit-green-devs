const { pool } = require('./pool');

const MAX_CANCELLATIONS = 5;
const SOLO_DRIVE_CO2_PER_KM = 0.192;
const DEVIATION_METERS_PER_MINUTE = 650;
const DEFAULT_MATCHING_RADIUS_METERS = 1600;
const COMPLETED_STATUSES = ['completed', 'ended'];
const DISCOVERABLE_STATUSES = ['scheduled', 'confirmed'];
const ACTIVE_STATUSES = ['draft', 'scheduled', 'confirmed', 'active'];
const ACTIVE_REQUEST_STATUSES = ['pending', 'accepted'];
const CARPOOL_LIVE_STAGES = [
  'waiting_for_riders',
  'ready_to_start',
  'driver_to_pickup',
  'rider_onboard',
  'driver_to_destination',
  'completed',
  'cancelled',
];

function roundTo(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function metersToMiles(value) {
  return value / 1609.34;
}

function formatTimestamp(value) {
  return new Date(value).toISOString();
}

function isCompletedStatus(status) {
  return COMPLETED_STATUSES.includes(status);
}

function isDiscoverableStatus(status) {
  return DISCOVERABLE_STATUSES.includes(status);
}

function mapPoint(point) {
  if (!point || typeof point !== 'object') {
    return null;
  }

  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function mapPathPoints(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((point) => mapPoint(point))
    .filter((point) => point != null);
}

function haversineMeters(start, end) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitudeRadians = (start.latitude * Math.PI) / 180;
  const endLatitudeRadians = (end.latitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(startLatitudeRadians) *
      Math.cos(endLatitudeRadians) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function getMinimumDistanceToPath(point, pathPoints) {
  if (!point || pathPoints.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return pathPoints.reduce((closestDistance, pathPoint) => {
    return Math.min(closestDistance, haversineMeters(point, pathPoint));
  }, Number.POSITIVE_INFINITY);
}

function estimateDeviationMinutes(pickupDistanceMeters, dropoffDistanceMeters) {
  return Math.max(
    1,
    Math.ceil((pickupDistanceMeters + dropoffDistanceMeters) / DEVIATION_METERS_PER_MINUTE)
  );
}

function computeEstimatedPrice(distanceMeters, pricePerMileUsd) {
  return roundTo(metersToMiles(distanceMeters) * pricePerMileUsd, 2);
}

function computeSoloDriveCo2Kg(distanceMeters) {
  return roundTo((distanceMeters / 1000) * SOLO_DRIVE_CO2_PER_KM, 3);
}

function computeSharedCo2SavedKg(actualTripCo2Kg, participantCount) {
  if (participantCount <= 1) {
    return 0;
  }

  return roundTo(actualTripCo2Kg * (participantCount - 1), 3);
}

function computeCarpoolImpactMultiplier(participantCount) {
  return roundTo(Math.max(participantCount, 1), 1);
}

function computeRiderCo2Savings(distanceMeters, actualTripCo2Kg, participantCount) {
  const soloDriveCo2Kg = computeSoloDriveCo2Kg(distanceMeters);
  const sharedCo2PerParticipantKg = participantCount > 0 ? actualTripCo2Kg / participantCount : actualTripCo2Kg;
  return Math.max(roundTo(soloDriveCo2Kg - sharedCo2PerParticipantKg, 3), 0);
}

function getMatchingRadiusMeters(trip) {
  return trip.matchingRadiusMeters > 0
    ? trip.matchingRadiusMeters
    : Math.max(trip.maxDeviationMinutes * DEVIATION_METERS_PER_MINUTE, DEFAULT_MATCHING_RADIUS_METERS);
}

function getDepartureDifferenceMinutes(left, right) {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) / (1000 * 60);
}

function buildTripMetadata(existingMetadata, patch) {
  return {
    ...(existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {}),
    ...patch,
  };
}

function mapCarpoolLiveStatus(metadata) {
  const liveStatus = metadata?.liveStatus;

  if (!liveStatus || typeof liveStatus !== 'object') {
    return null;
  }

  if (!CARPOOL_LIVE_STAGES.includes(liveStatus.stage)) {
    return null;
  }

  return {
    stage: liveStatus.stage,
    activeRequestId:
      liveStatus.activeRequestId == null ? null : Number.isInteger(Number(liveStatus.activeRequestId))
        ? Number(liveStatus.activeRequestId)
        : null,
    activeRiderId:
      liveStatus.activeRiderId == null ? null : Number.isInteger(Number(liveStatus.activeRiderId))
        ? Number(liveStatus.activeRiderId)
        : null,
    activeRiderName:
      typeof liveStatus.activeRiderName === 'string' && liveStatus.activeRiderName.trim()
        ? liveStatus.activeRiderName.trim()
        : null,
    note:
      typeof liveStatus.note === 'string' && liveStatus.note.trim()
        ? liveStatus.note.trim()
        : null,
    updatedAt:
      typeof liveStatus.updatedAt === 'string' && liveStatus.updatedAt.trim()
        ? formatTimestamp(liveStatus.updatedAt)
        : formatTimestamp(new Date()),
  };
}

function buildCarpoolLiveStatus(stage, request = null, note = null) {
  return {
    stage,
    activeRequestId: request?.id ?? null,
    activeRiderId: request?.riderId ?? null,
    activeRiderName: request?.riderName ?? null,
    note: note ?? null,
    updatedAt: formatTimestamp(new Date()),
  };
}

function mapCarpoolRequestRow(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    driverId: row.driver_id,
    riderId: row.rider_id,
    riderName: row.rider_name ?? null,
    status: row.status,
    riderOriginLabel: row.rider_origin_label,
    riderDestinationLabel: row.rider_destination_label,
    pickupPoint: mapPoint(row.pickup_point),
    dropoffPoint: mapPoint(row.dropoff_point),
    requestedDepartureTime: row.requested_departure_time,
    estimatedDistanceMeters: row.estimated_distance_meters,
    estimatedAddedMinutes: row.estimated_added_minutes,
    estimatedPriceUsd: Number(row.estimated_price_usd),
    decisionNote: row.decision_note,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipantRow(row) {
  return {
    userId: row.user_id,
    displayName: row.user_name,
    role: row.participant_role,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

function mapCarpoolTripRow(row) {
  const participantCount = Math.max(row.participant_count ?? 1, 1);

  return {
    id: row.id,
    userId: row.user_id,
    driverId: row.user_id,
    driverName: row.driver_name,
    routeType: row.route_type,
    routeTitle: row.route_title,
    originLabel: row.origin_label,
    destinationLabel: row.destination_label,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    co2Kg: Number(row.co2_kg),
    co2SavedKg: Number(row.co2_saved_kg),
    availableSeats: row.available_seats,
    seatCapacity: row.seat_capacity,
    pickupFlexibilityMinutes: row.pickup_flexibility_minutes,
    matchingRadiusMeters: row.matching_radius_meters,
    maxDeviationMinutes: row.max_deviation_minutes,
    pricePerMileUsd: Number(row.price_per_mile_usd),
    recurrencePattern: row.recurrence_pattern,
    recurrenceGroupKey: row.recurrence_group_key,
    status: row.status,
    departureTime: row.started_at,
    estimatedArrivalTime: row.completed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    pathPoints: mapPathPoints(row.path_points),
    metadata: row.metadata ?? {},
    liveStatus: mapCarpoolLiveStatus(row.metadata ?? {}),
    createdAt: row.created_at,
    participantCount,
    ridersHelped: row.riders_helped,
    acceptedRiders: row.accepted_riders,
    pendingRequestCount: row.pending_request_count,
    car: row.car_make
      ? {
          make: row.car_make,
          model: row.car_model,
          capacity: row.car_capacity,
        }
      : null,
    trustSignals: {
      ratingAverage: Number(row.carpool_rating_avg),
      ratingCount: row.carpool_rating_count,
      ridesCompleted: row.driver_completed_carpool_rides,
      ridersHelped: row.driver_total_riders_helped,
      cancellationCount: row.carpool_cancellation_count,
      blocked: row.carpool_blocked,
    },
    currentUserRequest:
      row.current_request_id == null
        ? null
        : {
            id: row.current_request_id,
            status: row.current_request_status,
            estimatedAddedMinutes: row.current_request_estimated_added_minutes,
            estimatedPriceUsd:
              row.current_request_estimated_price_usd == null
                ? null
                : Number(row.current_request_estimated_price_usd),
            requestedDepartureTime: row.current_request_requested_departure_time,
          },
  };
}

async function expireOutdatedRequests(db = pool) {
  await db.query(
    `
      UPDATE carpool_requests
      SET
        status = 'expired',
        responded_at = COALESCE(responded_at, NOW()),
        updated_at = NOW()
      WHERE status = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at <= NOW()
    `
  );
}

async function getLockedProfile(client, userId) {
  const result = await client.query(
    `
      SELECT
        profiles.*,
        cars.make AS car_make,
        cars.model AS car_model,
        cars.capacity AS car_capacity
      FROM profiles
      LEFT JOIN cars ON cars.id = profiles.car_id
      WHERE profiles.id = $1
      FOR UPDATE OF profiles
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Profile ${userId} does not exist.`);
  }

  return result.rows[0];
}

function assertCarpoolAccess(profile) {
  if (profile.carpool_blocked) {
    throw new Error('This user is blocked from carpool activity after too many cancellations.');
  }
}

async function findActiveDriverTrip(client, userId) {
  const result = await client.query(
    `
      SELECT id, route_title
      FROM trips
      WHERE user_id = $1
        AND route_type = 'carpool'
        AND status = ANY($2::text[])
      ORDER BY started_at ASC, id DESC
      LIMIT 1
    `,
    [userId, ACTIVE_STATUSES]
  );

  return result.rows[0] ?? null;
}

async function findActiveRiderCommitment(client, userId) {
  const requestResult = await client.query(
    `
      SELECT
        trips.id,
        trips.route_title
      FROM carpool_requests
      INNER JOIN trips ON trips.id = carpool_requests.trip_id
      WHERE carpool_requests.rider_id = $1
        AND carpool_requests.status = ANY($2::text[])
        AND trips.route_type = 'carpool'
        AND trips.status = ANY($3::text[])
      ORDER BY carpool_requests.created_at DESC, carpool_requests.id DESC
      LIMIT 1
    `,
    [userId, ACTIVE_REQUEST_STATUSES, ACTIVE_STATUSES]
  );

  if (requestResult.rowCount > 0) {
    return requestResult.rows[0];
  }

  const participantResult = await client.query(
    `
      SELECT
        trips.id,
        trips.route_title
      FROM trip_users
      INNER JOIN trips ON trips.id = trip_users.trip_id
      WHERE trip_users.user_id = $1
        AND trip_users.participant_role = 'rider'
        AND trip_users.left_at IS NULL
        AND trips.route_type = 'carpool'
        AND trips.status = ANY($2::text[])
      ORDER BY trip_users.joined_at DESC, trip_users.id DESC
      LIMIT 1
    `,
    [userId, ACTIVE_STATUSES]
  );

  return participantResult.rows[0] ?? null;
}

async function assertUserCanOfferCarpool(client, userId) {
  const activeDriverTrip = await findActiveDriverTrip(client, userId);

  if (activeDriverTrip) {
    throw new Error(
      `You are already hosting a carpool. Edit or finish ${activeDriverTrip.route_title} before posting another offer.`
    );
  }

  const activeRiderCommitment = await findActiveRiderCommitment(client, userId);

  if (activeRiderCommitment) {
    throw new Error(
      `Finish or cancel your current rider trip before offering a carpool. Active rider trip: ${activeRiderCommitment.route_title}.`
    );
  }
}

async function assertUserCanRequestCarpool(client, userId) {
  const activeDriverTrip = await findActiveDriverTrip(client, userId);

  if (activeDriverTrip) {
    throw new Error(
      `Finish or cancel your offered carpool before requesting a ride. Active driver trip: ${activeDriverTrip.route_title}.`
    );
  }
}

async function incrementCancellationCount(client, userId) {
  const result = await client.query(
    `
      UPDATE profiles
      SET
        carpool_cancellation_count = carpool_cancellation_count + 1,
        carpool_blocked = CASE
          WHEN carpool_cancellation_count + 1 > $2 THEN TRUE
          ELSE carpool_blocked
        END
      WHERE id = $1
      RETURNING carpool_cancellation_count, carpool_blocked
    `,
    [userId, MAX_CANCELLATIONS]
  );

  return result.rows[0];
}

async function getCarpoolTripRows({
  db = pool,
  currentUserId = null,
  whereClause = 'TRUE',
  values = [],
  orderBy = 'trips.started_at ASC, trips.id DESC',
}) {
  const queryValues = [...values, currentUserId];

  const result = await db.query(
    `
      SELECT
        trips.*,
        profiles.user_name AS driver_name,
        profiles.carpool_rating_avg,
        profiles.carpool_rating_count,
        profiles.carpool_cancellation_count,
        profiles.carpool_blocked,
        cars.make AS car_make,
        cars.model AS car_model,
        cars.capacity AS car_capacity,
        COALESCE(participant_counts.active_riders, 0)::INTEGER AS accepted_riders,
        GREATEST(COALESCE(participant_counts.active_participants, 0), 1)::INTEGER AS participant_count,
        COALESCE(participant_counts.active_riders, 0)::INTEGER AS riders_helped,
        COALESCE(pending_requests.pending_request_count, 0)::INTEGER AS pending_request_count,
        COALESCE(driver_history.completed_carpool_rides, 0)::INTEGER AS driver_completed_carpool_rides,
        COALESCE(driver_history.total_riders_helped, 0)::INTEGER AS driver_total_riders_helped,
        latest_request.id AS current_request_id,
        latest_request.status AS current_request_status,
        latest_request.estimated_added_minutes AS current_request_estimated_added_minutes,
        latest_request.estimated_price_usd AS current_request_estimated_price_usd,
        latest_request.requested_departure_time AS current_request_requested_departure_time
      FROM trips
      INNER JOIN profiles ON profiles.id = trips.user_id
      LEFT JOIN cars ON cars.id = profiles.car_id
      LEFT JOIN (
        SELECT
          trip_id,
          COUNT(*) FILTER (WHERE left_at IS NULL)::INTEGER AS active_participants,
          COUNT(*) FILTER (
            WHERE participant_role = 'rider'
              AND left_at IS NULL
          )::INTEGER AS active_riders
        FROM trip_users
        GROUP BY trip_id
      ) AS participant_counts ON participant_counts.trip_id = trips.id
      LEFT JOIN (
        SELECT
          trip_id,
          COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending_request_count
        FROM carpool_requests
        GROUP BY trip_id
      ) AS pending_requests ON pending_requests.trip_id = trips.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE trips.status IN ('completed', 'ended')
          )::INTEGER AS completed_carpool_rides,
          COALESCE(SUM(COALESCE(completed_counts.rider_count, 0)), 0)::INTEGER AS total_riders_helped
        FROM trips
        LEFT JOIN (
          SELECT
            trip_id,
            COUNT(*) FILTER (
              WHERE participant_role = 'rider'
                AND left_at IS NULL
            )::INTEGER AS rider_count
          FROM trip_users
          GROUP BY trip_id
        ) AS completed_counts ON completed_counts.trip_id = trips.id
        WHERE trips.user_id = profiles.id
          AND trips.route_type = 'carpool'
          AND trips.status IN ('completed', 'ended')
      ) AS driver_history ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          id,
          status,
          estimated_added_minutes,
          estimated_price_usd,
          requested_departure_time
        FROM carpool_requests
        WHERE trip_id = trips.id
          AND rider_id = $${queryValues.length}
        ORDER BY created_at DESC
        LIMIT 1
      ) AS latest_request ON TRUE
      WHERE ${whereClause}
      ORDER BY ${orderBy}
    `,
    queryValues
  );

  return result.rows;
}

async function getCarpoolTripById(tripId, currentUserId = null, db = pool) {
  const rows = await getCarpoolTripRows({
    db,
    currentUserId,
    whereClause: 'trips.id = $1 AND trips.route_type = $2',
    values: [tripId, 'carpool'],
    orderBy: 'trips.id DESC',
  });

  if (!rows[0]) {
    throw new Error(`Carpool trip ${tripId} does not exist.`);
  }

  return mapCarpoolTripRow(rows[0]);
}

async function getTripParticipants(db, tripIds) {
  if (tripIds.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        trip_users.trip_id,
        trip_users.user_id,
        trip_users.participant_role,
        trip_users.joined_at,
        trip_users.left_at,
        profiles.user_name
      FROM trip_users
      INNER JOIN profiles ON profiles.id = trip_users.user_id
      WHERE trip_users.trip_id = ANY($1::int[])
      ORDER BY
        trip_users.trip_id ASC,
        CASE WHEN trip_users.participant_role = 'driver' THEN 0 ELSE 1 END ASC,
        trip_users.joined_at ASC
    `,
    [tripIds]
  );

  return result.rows.reduce((grouped, row) => {
    const current = grouped.get(row.trip_id) ?? [];
    current.push(mapParticipantRow(row));
    grouped.set(row.trip_id, current);
    return grouped;
  }, new Map());
}

async function getTripRequests(db, tripIds) {
  if (tripIds.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        carpool_requests.*,
        profiles.user_name AS rider_name
      FROM carpool_requests
      INNER JOIN profiles ON profiles.id = carpool_requests.rider_id
      WHERE carpool_requests.trip_id = ANY($1::int[])
      ORDER BY carpool_requests.trip_id ASC, carpool_requests.created_at DESC
    `,
    [tripIds]
  );

  return result.rows.reduce((grouped, row) => {
    const current = grouped.get(row.trip_id) ?? [];
    current.push(mapCarpoolRequestRow(row));
    grouped.set(row.trip_id, current);
    return grouped;
  }, new Map());
}

async function getAcceptedRequestsForTrip(db, tripId) {
  const result = await db.query(
    `
      SELECT
        carpool_requests.*,
        profiles.user_name AS rider_name
      FROM carpool_requests
      INNER JOIN profiles ON profiles.id = carpool_requests.rider_id
      WHERE carpool_requests.trip_id = $1
        AND carpool_requests.status = 'accepted'
      ORDER BY
        carpool_requests.responded_at ASC NULLS LAST,
        carpool_requests.created_at ASC,
        carpool_requests.id ASC
    `,
    [tripId]
  );

  return result.rows.map((row) => mapCarpoolRequestRow(row));
}

async function setTripLiveStatus(client, trip, liveStatus) {
  const nextMetadata = buildTripMetadata(trip.metadata, {
    liveStatus,
  });

  await client.query(
    `
      UPDATE trips
      SET metadata = $2::jsonb
      WHERE id = $1
    `,
    [trip.id, JSON.stringify(nextMetadata)]
  );
}

async function refreshPreStartLiveStatus(client, trip) {
  const acceptedRequests = await getAcceptedRequestsForTrip(client, trip.id);
  const liveStatus = acceptedRequests[0]
    ? buildCarpoolLiveStatus(
        'ready_to_start',
        acceptedRequests[0],
        `Ready to pick up ${acceptedRequests[0].riderName ?? 'your rider'} once the driver starts.`
      )
    : buildCarpoolLiveStatus(
        'waiting_for_riders',
        null,
        'Waiting for rider requests before the shared trip can start.'
      );

  await setTripLiveStatus(client, trip, liveStatus);
}

function enrichCarpoolTrip(trip, participants, requests, userId) {
  const currentUserRole = trip.driverId === userId ? 'driver' : 'rider';

  return {
    ...trip,
    currentUserRole,
    canManageRequests: currentUserRole === 'driver' && trip.pendingRequestCount > 0,
    requests,
    participants,
    carpoolImpactMultiplier: computeCarpoolImpactMultiplier(trip.participantCount),
  };
}

async function getEnrichedCarpoolTripById(tripId, currentUserId = null, db = pool) {
  const trip = await getCarpoolTripById(tripId, currentUserId, db);
  const [participantsByTrip, requestsByTrip] = await Promise.all([
    getTripParticipants(db, [tripId]),
    getTripRequests(db, [tripId]),
  ]);

  return enrichCarpoolTrip(
    trip,
    participantsByTrip.get(tripId) ?? [],
    requestsByTrip.get(tripId) ?? [],
    currentUserId ?? trip.driverId
  );
}

function buildSearchSuggestion(matches, routeDistanceMeters) {
  if (matches.length === 0) {
    return null;
  }

  const bestMatch = matches[0];
  const baselineCo2Kg = computeSoloDriveCo2Kg(routeDistanceMeters);

  if (baselineCo2Kg <= 0) {
    return null;
  }

  const savingsPercent = Math.round((bestMatch.estimatedCo2SavedKg / baselineCo2Kg) * 100);

  return `People are going your way - share this ride and reduce emissions by ${Math.max(
    Math.min(savingsPercent, 95),
    5
  )}%.`;
}

async function searchAvailableCarpools(filters) {
  await expireOutdatedRequests();

  const rows = await getCarpoolTripRows({
    currentUserId: filters.userId,
    whereClause: 'trips.route_type = $1 AND trips.user_id <> $2',
    values: ['carpool', filters.userId],
    orderBy: 'trips.started_at ASC, trips.id DESC',
  });

  const matches = rows
    .map((row) => mapCarpoolTripRow(row))
    .filter((trip) => isDiscoverableStatus(trip.status))
    .map((trip) => {
      const pickupDistanceMeters = getMinimumDistanceToPath(filters.origin, trip.pathPoints);
      const dropoffDistanceMeters = getMinimumDistanceToPath(filters.destination, trip.pathPoints);
      const estimatedAddedMinutes = estimateDeviationMinutes(
        pickupDistanceMeters,
        dropoffDistanceMeters
      );
      const departureDifferenceMinutes = getDepartureDifferenceMinutes(
        filters.desiredDepartureTime,
        trip.departureTime
      );
      const matchingRadiusMeters = getMatchingRadiusMeters(trip);
      const nextParticipantCount =
        trip.currentUserRequest?.status === 'accepted'
          ? trip.participantCount
          : trip.participantCount + 1;
      const estimatedDistanceMeters = Math.max(filters.routeDistanceMeters, 1);
      const estimatedPriceUsd = computeEstimatedPrice(
        estimatedDistanceMeters,
        trip.pricePerMileUsd
      );
      const estimatedCo2SavedKg = computeRiderCo2Savings(
        estimatedDistanceMeters,
        trip.co2Kg,
        nextParticipantCount
      );

      return {
        ...trip,
        matchingRadiusMeters,
        pickupDistanceMeters: Math.round(pickupDistanceMeters),
        dropoffDistanceMeters: Math.round(dropoffDistanceMeters),
        estimatedAddedMinutes,
        departureDifferenceMinutes: Math.round(departureDifferenceMinutes),
        estimatedPriceUsd,
        estimatedDistanceMeters,
        estimatedCo2SavedKg,
        carpoolImpactMultiplier: computeCarpoolImpactMultiplier(nextParticipantCount),
      };
    })
    .filter((trip) => {
      const withinPickupRadius =
        trip.pickupDistanceMeters <= trip.matchingRadiusMeters &&
        trip.dropoffDistanceMeters <= trip.matchingRadiusMeters;
      const withinTimeWindow =
        trip.departureDifferenceMinutes <=
        filters.windowMinutes + trip.pickupFlexibilityMinutes;
      const withinDeviation = trip.estimatedAddedMinutes <= Math.max(trip.maxDeviationMinutes, 1);
      const hasSeats = trip.availableSeats > 0 || trip.currentUserRequest?.status === 'accepted';

      return withinPickupRadius && withinTimeWindow && withinDeviation && hasSeats;
    })
    .sort((left, right) => {
      if (left.currentUserRequest?.status === 'accepted' && right.currentUserRequest?.status !== 'accepted') {
        return -1;
      }

      if (left.currentUserRequest?.status !== 'accepted' && right.currentUserRequest?.status === 'accepted') {
        return 1;
      }

      if (left.estimatedAddedMinutes !== right.estimatedAddedMinutes) {
        return left.estimatedAddedMinutes - right.estimatedAddedMinutes;
      }

      if (left.departureDifferenceMinutes !== right.departureDifferenceMinutes) {
        return left.departureDifferenceMinutes - right.departureDifferenceMinutes;
      }

      if (left.estimatedCo2SavedKg !== right.estimatedCo2SavedKg) {
        return right.estimatedCo2SavedKg - left.estimatedCo2SavedKg;
      }

      return left.estimatedPriceUsd - right.estimatedPriceUsd;
    });

  return {
    matches,
    suggestion: buildSearchSuggestion(matches, filters.routeDistanceMeters),
  };
}

async function createCarpoolTrip(payload) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const profile = await getLockedProfile(client, payload.userId);
    assertCarpoolAccess(profile);
    await assertUserCanOfferCarpool(client, payload.userId);

    if (!profile.car_id || !profile.car_capacity) {
      throw new Error('Drivers need a linked car before they can publish a carpool.');
    }

    if (payload.availableSeats > profile.car_capacity - 1) {
      throw new Error(
        `Available seats must be ${profile.car_capacity - 1} or less for the linked vehicle.`
      );
    }

    const metadata = buildTripMetadata(payload.metadata, {
      badges: ['Shared ride', 'Carpool'],
      routeSummary: payload.routeSummary,
      pricingModel: 'informational_estimate',
      paymentMode: 'mock_informational_only',
      liveStatus: buildCarpoolLiveStatus(
        'waiting_for_riders',
        null,
        'Waiting for riders to request a seat.'
      ),
    });

    const result = await client.query(
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
          seat_capacity,
          pickup_flexibility_minutes,
          matching_radius_meters,
          max_deviation_minutes,
          price_per_mile_usd,
          recurrence_pattern,
          recurrence_group_key,
          status,
          started_at,
          completed_at,
          path_points,
          metadata
        )
        VALUES (
          $1, 'carpool', $2, $3, $4, $5, $6, $7, 0,
          $8, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb
        )
        RETURNING id
      `,
      [
        payload.userId,
        payload.routeTitle,
        payload.originLabel,
        payload.destinationLabel,
        payload.distanceMeters,
        payload.durationSeconds,
        payload.co2Kg,
        payload.availableSeats,
        payload.pickupFlexibilityMinutes,
        payload.matchingRadiusMeters,
        payload.maxDeviationMinutes,
        payload.pricePerMileUsd,
        payload.recurrencePattern,
        payload.recurrenceGroupKey,
        payload.status,
        payload.departureTime,
        payload.estimatedArrivalTime,
        JSON.stringify(payload.pathPoints),
        JSON.stringify(metadata),
      ]
    );

    await client.query(
      `
        INSERT INTO trip_users (
          trip_id,
          driver_id,
          rider_id,
          user_id,
          participant_role,
          joined_at
        )
        VALUES ($1, $2, $2, $2, 'driver', NOW())
        ON CONFLICT (trip_id, rider_id)
        DO NOTHING
      `,
      [result.rows[0].id, payload.userId]
    );

    await client.query('COMMIT');

    return getEnrichedCarpoolTripById(result.rows[0].id, payload.userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function assertTripCanReceiveRequests(trip) {
  if (!isDiscoverableStatus(trip.status)) {
    throw new Error('This carpool is not accepting new requests right now.');
  }

  if (trip.availableSeats <= 0) {
    throw new Error('This carpool is already full.');
  }
}

function assertRequestMatch(trip, payload) {
  const pickupDistanceMeters = getMinimumDistanceToPath(payload.pickupPoint, trip.pathPoints);
  const dropoffDistanceMeters = getMinimumDistanceToPath(payload.dropoffPoint, trip.pathPoints);
  const estimatedAddedMinutes = estimateDeviationMinutes(pickupDistanceMeters, dropoffDistanceMeters);
  const departureDifferenceMinutes = getDepartureDifferenceMinutes(
    payload.desiredDepartureTime,
    trip.departureTime
  );
  const matchingRadiusMeters = getMatchingRadiusMeters(trip);

  if (pickupDistanceMeters > matchingRadiusMeters || dropoffDistanceMeters > matchingRadiusMeters) {
    throw new Error('Pickup and drop-off need to stay within the driver’s allowed route radius.');
  }

  if (estimatedAddedMinutes > Math.max(trip.maxDeviationMinutes, 1)) {
    throw new Error('This request would exceed the driver’s allowed deviation time.');
  }

  if (departureDifferenceMinutes > payload.windowMinutes + trip.pickupFlexibilityMinutes) {
    throw new Error('This request falls outside the driver’s departure flexibility window.');
  }

  return {
    pickupDistanceMeters: Math.round(pickupDistanceMeters),
    dropoffDistanceMeters: Math.round(dropoffDistanceMeters),
    estimatedAddedMinutes,
    matchingRadiusMeters,
  };
}

async function createCarpoolRequest(payload) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await expireOutdatedRequests(client);

    const riderProfile = await getLockedProfile(client, payload.userId);
    assertCarpoolAccess(riderProfile);
    await assertUserCanRequestCarpool(client, payload.userId);

    const trip = await getCarpoolTripById(payload.tripId, payload.userId, client);
    assertTripCanReceiveRequests(trip);

    if (trip.driverId === payload.userId) {
      throw new Error('Drivers cannot request a seat in their own carpool.');
    }

    const existingRequestResult = await client.query(
      `
        SELECT id, status
        FROM carpool_requests
        WHERE trip_id = $1
          AND rider_id = $2
          AND status = ANY($3::text[])
        LIMIT 1
        FOR UPDATE
      `,
      [payload.tripId, payload.userId, ACTIVE_REQUEST_STATUSES]
    );

    if (existingRequestResult.rowCount > 0) {
      throw new Error('You already have an active request for this carpool.');
    }

    const match = assertRequestMatch(trip, payload);
    const estimatedPriceUsd = computeEstimatedPrice(
      payload.estimatedDistanceMeters,
      trip.pricePerMileUsd
    );

    const result = await client.query(
      `
        INSERT INTO carpool_requests (
          trip_id,
          driver_id,
          rider_id,
          status,
          rider_origin_label,
          rider_destination_label,
          pickup_point,
          dropoff_point,
          requested_departure_time,
          estimated_distance_meters,
          estimated_added_minutes,
          estimated_price_usd,
          decision_note,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, 'pending', $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, NOW(), NOW()
        )
        RETURNING *
      `,
      [
        payload.tripId,
        trip.driverId,
        payload.userId,
        payload.originLabel,
        payload.destinationLabel,
        JSON.stringify(payload.pickupPoint),
        JSON.stringify(payload.dropoffPoint),
        payload.desiredDepartureTime,
        payload.estimatedDistanceMeters,
        match.estimatedAddedMinutes,
        estimatedPriceUsd,
        `Adds about ${match.estimatedAddedMinutes} minutes to the baseline route.`,
        new Date(new Date(trip.departureTime).getTime() - 15 * 60 * 1000).toISOString(),
      ]
    );

    await client.query('COMMIT');

    const createdRequest = mapCarpoolRequestRow(result.rows[0]);
    return {
      ...createdRequest,
      pickupDistanceMeters: match.pickupDistanceMeters,
      dropoffDistanceMeters: match.dropoffDistanceMeters,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateCarpoolTrip({ tripId, ...payload }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const profile = await getLockedProfile(client, payload.userId);
    assertCarpoolAccess(profile);

    if (!profile.car_id || !profile.car_capacity) {
      throw new Error('Drivers need a linked car before they can update a carpool.');
    }

    const trip = await loadLockedCarpoolTrip(client, tripId);

    if (trip.user_id !== payload.userId) {
      throw new Error('Only the driver can edit this carpool.');
    }

    if (!['draft', 'scheduled', 'confirmed'].includes(trip.status)) {
      throw new Error('Only draft, scheduled, or confirmed carpools can be edited.');
    }

    const activeRiderCountResult = await client.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE participant_role = 'rider'
              AND left_at IS NULL
          )::INTEGER AS active_rider_count
        FROM trip_users
        WHERE trip_id = $1
      `,
      [tripId]
    );

    const activeRiderCount = activeRiderCountResult.rows[0]?.active_rider_count ?? 0;
    const nextSeatCapacity = payload.availableSeats + activeRiderCount;

    if (nextSeatCapacity > profile.car_capacity - 1) {
      throw new Error(
        `Open seats plus accepted riders must be ${profile.car_capacity - 1} or less for the linked vehicle.`
      );
    }

    const metadata = buildTripMetadata(payload.metadata, {
      badges: ['Shared ride', 'Carpool'],
      routeSummary: payload.routeSummary,
      pricingModel: 'informational_estimate',
      paymentMode: 'mock_informational_only',
    });

    await client.query(
      `
        UPDATE trips
        SET
          route_title = $2,
          origin_label = $3,
          destination_label = $4,
          distance_meters = $5,
          duration_seconds = $6,
          co2_kg = $7,
          available_seats = $8,
          seat_capacity = $9,
          pickup_flexibility_minutes = $10,
          matching_radius_meters = $11,
          max_deviation_minutes = $12,
          price_per_mile_usd = $13,
          recurrence_pattern = $14,
          recurrence_group_key = $15,
          status = $16,
          started_at = $17,
          completed_at = $18,
          path_points = $19::jsonb,
          metadata = $20::jsonb
        WHERE id = $1
      `,
      [
        tripId,
        payload.routeTitle,
        payload.originLabel,
        payload.destinationLabel,
        payload.distanceMeters,
        payload.durationSeconds,
        payload.co2Kg,
        payload.availableSeats,
        nextSeatCapacity,
        payload.pickupFlexibilityMinutes,
        payload.matchingRadiusMeters,
        payload.maxDeviationMinutes,
        payload.pricePerMileUsd,
        payload.recurrencePattern,
        payload.recurrenceGroupKey,
        trip.status === 'confirmed' && activeRiderCount > 0 ? 'confirmed' : payload.status,
        payload.departureTime,
        payload.estimatedArrivalTime,
        JSON.stringify(payload.pathPoints),
        JSON.stringify(metadata),
      ]
    );

    await client.query('COMMIT');
    return getEnrichedCarpoolTripById(tripId, payload.userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadLockedCarpoolTrip(client, tripId) {
  const result = await client.query(
    `
      SELECT
        trips.*,
        profiles.user_name AS driver_name,
        profiles.carpool_rating_avg,
        profiles.carpool_rating_count,
        profiles.carpool_cancellation_count,
        profiles.carpool_blocked,
        cars.make AS car_make,
        cars.model AS car_model,
        cars.capacity AS car_capacity
      FROM trips
      INNER JOIN profiles ON profiles.id = trips.user_id
      LEFT JOIN cars ON cars.id = profiles.car_id
      WHERE trips.id = $1
        AND trips.route_type = 'carpool'
      FOR UPDATE OF trips
    `,
    [tripId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Carpool trip ${tripId} does not exist.`);
  }

  return result.rows[0];
}

async function loadLockedRequest(client, requestId, tripId) {
  const result = await client.query(
    `
      SELECT *
      FROM carpool_requests
      WHERE id = $1
        AND trip_id = $2
      FOR UPDATE
    `,
    [requestId, tripId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Carpool request ${requestId} does not exist.`);
  }

  return result.rows[0];
}

async function updateTripStatusFromAcceptedRiders(client, tripId) {
  const result = await client.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE participant_role = 'rider'
            AND left_at IS NULL
        )::INTEGER AS accepted_riders
      FROM trip_users
      WHERE trip_id = $1
    `,
    [tripId]
  );

  const acceptedRiders = result.rows[0]?.accepted_riders ?? 0;
  const nextStatus = acceptedRiders > 0 ? 'confirmed' : 'scheduled';

  await client.query(
    `
      UPDATE trips
      SET status = CASE
        WHEN status IN ('scheduled', 'confirmed') THEN $2
        ELSE status
      END
      WHERE id = $1
    `,
    [tripId, nextStatus]
  );
}

async function acceptCarpoolRequest({ tripId, requestId, userId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await expireOutdatedRequests(client);

    const trip = await loadLockedCarpoolTrip(client, tripId);

    if (trip.user_id !== userId) {
      throw new Error('Only the driver can approve this request.');
    }

    if (!ACTIVE_STATUSES.includes(trip.status)) {
      throw new Error('This carpool can no longer be updated.');
    }

    if (trip.available_seats <= 0) {
      throw new Error('No seats remain on this carpool.');
    }

    const request = await loadLockedRequest(client, requestId, tripId);

    if (request.status !== 'pending') {
      throw new Error('Only pending requests can be approved.');
    }

    await client.query(
      `
        UPDATE carpool_requests
        SET
          status = 'accepted',
          responded_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [requestId]
    );

    await client.query(
      `
        INSERT INTO trip_users (
          trip_id,
          driver_id,
          rider_id,
          user_id,
          participant_role,
          joined_at,
          joined_via_request_id,
          left_at
        )
        VALUES ($1, $2, $3, $3, 'rider', NOW(), $4, NULL)
        ON CONFLICT (trip_id, rider_id)
        DO UPDATE
        SET
          user_id = EXCLUDED.user_id,
          participant_role = EXCLUDED.participant_role,
          joined_at = NOW(),
          joined_via_request_id = EXCLUDED.joined_via_request_id,
          left_at = NULL
      `,
      [tripId, trip.user_id, request.rider_id, requestId]
    );

    await client.query(
      `
        UPDATE trips
        SET available_seats = GREATEST(available_seats - 1, 0)
        WHERE id = $1
      `,
      [tripId]
    );

    await updateTripStatusFromAcceptedRiders(client, tripId);
    await refreshPreStartLiveStatus(client, trip);
    await client.query('COMMIT');

    return getEnrichedCarpoolTripById(tripId, userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function rejectCarpoolRequest({ tripId, requestId, userId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const trip = await loadLockedCarpoolTrip(client, tripId);

    if (trip.user_id !== userId) {
      throw new Error('Only the driver can reject this request.');
    }

    const request = await loadLockedRequest(client, requestId, tripId);

    if (request.status !== 'pending') {
      throw new Error('Only pending requests can be rejected.');
    }

    await client.query(
      `
        UPDATE carpool_requests
        SET
          status = 'rejected',
          responded_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [requestId]
    );

    await client.query('COMMIT');
    return getEnrichedCarpoolTripById(tripId, userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelCarpoolRequest({ tripId, requestId, userId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const trip = await loadLockedCarpoolTrip(client, tripId);
    const request = await loadLockedRequest(client, requestId, tripId);

    if (request.rider_id !== userId) {
      throw new Error('Only the rider can cancel this request.');
    }

    if (!['pending', 'accepted'].includes(request.status)) {
      throw new Error('This request can no longer be cancelled.');
    }

    if (request.status === 'accepted' && trip.status === 'active') {
      throw new Error('Accepted riders cannot cancel once the carpool has started.');
    }

    await client.query(
      `
        UPDATE carpool_requests
        SET
          status = 'cancelled_by_rider',
          cancelled_at = NOW(),
          responded_at = COALESCE(responded_at, NOW()),
          updated_at = NOW()
        WHERE id = $1
      `,
      [requestId]
    );

    if (request.status === 'accepted') {
      await client.query(
        `
          UPDATE trip_users
          SET left_at = NOW()
          WHERE trip_id = $1
            AND user_id = $2
            AND participant_role = 'rider'
        `,
        [tripId, userId]
      );

      await client.query(
        `
          UPDATE trips
          SET available_seats = LEAST(available_seats + 1, seat_capacity)
          WHERE id = $1
        `,
        [tripId]
      );

      await updateTripStatusFromAcceptedRiders(client, tripId);
      await refreshPreStartLiveStatus(client, trip);
    }

    await incrementCancellationCount(client, userId);
    await client.query('COMMIT');
    return getEnrichedCarpoolTripById(tripId, userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function startCarpoolTrip({ tripId, userId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const trip = await loadLockedCarpoolTrip(client, tripId);

    if (trip.user_id !== userId) {
      throw new Error('Only the driver can start this carpool.');
    }

    if (trip.status !== 'confirmed') {
      throw new Error('Only confirmed carpools with accepted riders can be started.');
    }

    const acceptedRequests = await getAcceptedRequestsForTrip(client, tripId);

    if (acceptedRequests.length === 0) {
      throw new Error('Only confirmed carpools with accepted riders can be started.');
    }

    await client.query(
      `
        UPDATE trips
        SET
          status = 'active',
          started_at = NOW()
        WHERE id = $1
      `,
      [tripId]
    );

    await setTripLiveStatus(
      client,
      trip,
      buildCarpoolLiveStatus(
        'driver_to_pickup',
        acceptedRequests[0],
        `Heading to pick up ${acceptedRequests[0].riderName ?? 'your rider'}.`
      )
    );

    await client.query('COMMIT');
    return getEnrichedCarpoolTripById(tripId, userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeCarpoolTrip({ tripId, userId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const trip = await loadLockedCarpoolTrip(client, tripId);

    if (trip.user_id !== userId) {
      throw new Error('Only the driver can complete this carpool.');
    }

    if (!['scheduled', 'confirmed', 'active'].includes(trip.status)) {
      throw new Error('This carpool cannot be completed from its current state.');
    }

    const participantsResult = await client.query(
      `
        SELECT user_id, participant_role
        FROM trip_users
        WHERE trip_id = $1
          AND left_at IS NULL
        ORDER BY participant_role ASC, user_id ASC
      `,
      [tripId]
    );

    const participantRows = participantsResult.rows;
    const participantCount = Math.max(participantRows.length, 1);
    const riderCount = participantRows.filter((participant) => participant.participant_role === 'rider').length;
    const sharedCo2SavedKg = computeSharedCo2SavedKg(Number(trip.co2_kg), participantCount);
    const impactMultiplier = computeCarpoolImpactMultiplier(participantCount);
    const driverPoints = riderCount > 0 ? Math.round(sharedCo2SavedKg * 140) + riderCount * 75 : 0;
    const riderPoints =
      riderCount > 0
        ? Math.max(Math.round((sharedCo2SavedKg / participantCount) * 110) + 60, 80)
        : 0;
    const nextMetadata = buildTripMetadata(trip.metadata, {
      badges: ['Shared ride', 'Completed carpool'],
      carpoolSummary: {
        participantCount,
        riderCount,
        sharedCo2SavedKg,
        impactMultiplier,
        driverPoints,
        riderPoints,
        pricingModel: 'informational_estimate',
      },
      liveStatus: buildCarpoolLiveStatus(
        'completed',
        null,
        'Carpool completed for all participants.'
      ),
    });

    await client.query(
      `
        UPDATE trips
        SET
          status = 'completed',
          completed_at = NOW(),
          co2_saved_kg = $2,
          metadata = $3::jsonb
        WHERE id = $1
      `,
      [tripId, sharedCo2SavedKg, JSON.stringify(nextMetadata)]
    );

    if (driverPoints > 0 || riderPoints > 0) {
      for (const participant of participantRows) {
        const pointsToAward = participant.participant_role === 'driver' ? driverPoints : riderPoints;

        await client.query(
          `
            UPDATE profiles
            SET total_points = total_points + $2
            WHERE id = $1
          `,
          [participant.user_id, pointsToAward]
        );
      }
    }

    await client.query('COMMIT');
    return getEnrichedCarpoolTripById(tripId, userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelCarpoolTrip({ tripId, userId }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const trip = await loadLockedCarpoolTrip(client, tripId);

    if (trip.user_id !== userId) {
      throw new Error('Only the driver can cancel this carpool.');
    }

    if (!ACTIVE_STATUSES.includes(trip.status)) {
      throw new Error('This carpool cannot be cancelled from its current state.');
    }

    await client.query(
      `
        UPDATE trips
        SET
          status = 'cancelled',
          metadata = $2::jsonb
        WHERE id = $1
      `,
      [
        tripId,
        JSON.stringify(
          buildTripMetadata(trip.metadata, {
            liveStatus: buildCarpoolLiveStatus(
              'cancelled',
              null,
              'The driver cancelled this shared ride.'
            ),
          })
        ),
      ]
    );

    await client.query(
      `
        UPDATE carpool_requests
        SET
          status = CASE
            WHEN status IN ('pending', 'accepted') THEN 'expired'
            ELSE status
          END,
          decision_note = CASE
            WHEN status IN ('pending', 'accepted') THEN 'Trip cancelled by driver.'
            ELSE decision_note
          END,
          responded_at = CASE
            WHEN status IN ('pending', 'accepted') THEN NOW()
            ELSE responded_at
          END,
          updated_at = NOW()
        WHERE trip_id = $1
      `,
      [tripId]
    );

    await client.query(
      `
        UPDATE trip_users
        SET left_at = NOW()
        WHERE trip_id = $1
          AND participant_role = 'rider'
          AND left_at IS NULL
      `,
      [tripId]
    );

    await incrementCancellationCount(client, userId);
    await client.query('COMMIT');
    return getEnrichedCarpoolTripById(tripId, userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateCarpoolLiveStatus({ tripId, userId, stage, activeRequestId = null, note = null }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const trip = await loadLockedCarpoolTrip(client, tripId);

    if (trip.user_id !== userId) {
      throw new Error('Only the driver can update live carpool status.');
    }

    if (!['confirmed', 'active'].includes(trip.status)) {
      throw new Error('Live carpool status can only be updated for confirmed or active trips.');
    }

    let activeRequest = null;

    if (activeRequestId != null) {
      const acceptedRequests = await getAcceptedRequestsForTrip(client, tripId);
      activeRequest = acceptedRequests.find((request) => request.id === activeRequestId) ?? null;

      if (!activeRequest) {
        throw new Error('Live status must reference an accepted rider request on this trip.');
      }
    }

    await setTripLiveStatus(client, trip, buildCarpoolLiveStatus(stage, activeRequest, note));
    await client.query('COMMIT');
    return getEnrichedCarpoolTripById(tripId, userId, client);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listMyCarpools(userId) {
  await expireOutdatedRequests();

  const rows = await getCarpoolTripRows({
    currentUserId: userId,
    whereClause: `
      trips.route_type = $1
      AND (
        trips.user_id = $2
        OR EXISTS (
          SELECT 1
          FROM trip_users
          WHERE trip_users.trip_id = trips.id
            AND trip_users.user_id = $2
        )
        OR EXISTS (
          SELECT 1
          FROM carpool_requests
          WHERE carpool_requests.trip_id = trips.id
            AND carpool_requests.rider_id = $2
        )
      )
    `,
    values: ['carpool', userId],
    orderBy: `
      CASE trips.status
        WHEN 'active' THEN 0
        WHEN 'confirmed' THEN 1
        WHEN 'scheduled' THEN 2
        WHEN 'draft' THEN 3
        ELSE 4
      END ASC,
      trips.started_at ASC,
      trips.id DESC
    `,
  });

  const trips = rows.map((row) => mapCarpoolTripRow(row));
  const tripIds = trips.map((trip) => trip.id);
  const [participantsByTrip, requestsByTrip] = await Promise.all([
    getTripParticipants(pool, tripIds),
    getTripRequests(pool, tripIds),
  ]);

  return trips.map((trip) =>
    enrichCarpoolTrip(
      trip,
      participantsByTrip.get(trip.id) ?? [],
      requestsByTrip.get(trip.id) ?? [],
      userId
    )
  );
}

async function getGlobalCarpoolMetrics() {
  const summaryResult = await pool.query(
    `
      WITH participant_counts AS (
        SELECT
          trip_id,
          COUNT(*) FILTER (WHERE left_at IS NULL)::INTEGER AS participant_count,
          COUNT(*) FILTER (
            WHERE participant_role = 'rider'
              AND left_at IS NULL
          )::INTEGER AS rider_count
        FROM trip_users
        GROUP BY trip_id
      )
      SELECT
        COUNT(*) FILTER (
          WHERE trips.route_type = 'carpool'
            AND trips.status IN ('completed', 'ended')
        )::INTEGER AS completed_carpools,
        COUNT(*) FILTER (
          WHERE trips.route_type = 'carpool'
            AND trips.status IN ('draft', 'scheduled', 'confirmed', 'active')
        )::INTEGER AS live_carpools,
        COALESCE(SUM(CASE
          WHEN trips.route_type = 'carpool'
            AND trips.status IN ('completed', 'ended')
          THEN COALESCE(participant_counts.participant_count, 1)
          ELSE 0
        END), 0)::INTEGER AS total_shared_rides,
        COALESCE(SUM(CASE
          WHEN trips.route_type = 'carpool'
            AND trips.status IN ('completed', 'ended')
          THEN COALESCE(participant_counts.rider_count, 0)
          ELSE 0
        END), 0)::INTEGER AS total_riders_helped,
        COALESCE(SUM(CASE
          WHEN trips.route_type = 'carpool'
            AND trips.status IN ('completed', 'ended')
          THEN trips.co2_saved_kg
          ELSE 0
        END), 0)::FLOAT8 AS total_carpool_co2_saved_kg
      FROM trips
      LEFT JOIN participant_counts ON participant_counts.trip_id = trips.id
    `
  );

  const ecoDriversResult = await pool.query(
    `
      WITH driver_totals AS (
        SELECT
          profiles.id AS user_id,
          profiles.user_name AS display_name,
          COALESCE(SUM(participant_counts.rider_count), 0)::INTEGER AS riders_helped,
          COALESCE(SUM(trips.co2_saved_kg), 0)::FLOAT8 AS total_carpool_co2_saved_kg,
          COUNT(*) FILTER (
            WHERE trips.status IN ('completed', 'ended')
          )::INTEGER AS completed_carpools
        FROM profiles
        INNER JOIN trips ON trips.user_id = profiles.id
        LEFT JOIN (
          SELECT
            trip_id,
            COUNT(*) FILTER (
              WHERE participant_role = 'rider'
                AND left_at IS NULL
            )::INTEGER AS rider_count
          FROM trip_users
          GROUP BY trip_id
        ) AS participant_counts ON participant_counts.trip_id = trips.id
        WHERE trips.route_type = 'carpool'
          AND trips.status IN ('completed', 'ended')
        GROUP BY profiles.id, profiles.user_name
      )
      SELECT
        user_id,
        display_name,
        riders_helped,
        total_carpool_co2_saved_kg,
        completed_carpools
      FROM driver_totals
      ORDER BY
        total_carpool_co2_saved_kg DESC,
        riders_helped DESC,
        completed_carpools DESC,
        user_id ASC
      LIMIT 5
    `
  );

  const summaryRow = summaryResult.rows[0];

  return {
    summary: {
      completedCarpools: summaryRow.completed_carpools,
      liveCarpools: summaryRow.live_carpools,
      totalSharedRides: summaryRow.total_shared_rides,
      totalRidersHelped: summaryRow.total_riders_helped,
      totalCarpoolCo2SavedKg: Number(summaryRow.total_carpool_co2_saved_kg),
    },
    ecoDrivers: ecoDriversResult.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      ridersHelped: row.riders_helped,
      totalCarpoolCo2SavedKg: Number(row.total_carpool_co2_saved_kg),
      completedCarpools: row.completed_carpools,
    })),
  };
}

module.exports = {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  DEFAULT_MATCHING_RADIUS_METERS,
  createCarpoolRequest,
  createCarpoolTrip,
  getCarpoolTripById,
  getGlobalCarpoolMetrics,
  listMyCarpools,
  updateCarpoolTrip,
  searchAvailableCarpools,
  acceptCarpoolRequest,
  cancelCarpoolRequest,
  cancelCarpoolTrip,
  completeCarpoolTrip,
  expireOutdatedRequests,
  rejectCarpoolRequest,
  startCarpoolTrip,
  updateCarpoolLiveStatus,
};
