const { pool } = require('./pool');
const { createTripRecord } = require('./trip-queries');

const CARPOOL_ROUTE_TYPES = ['carpool', 'drive'];
const DISCOVERY_STATUSES = ['active', 'scheduled'];
const DEFAULT_SOURCE_RADIUS_METERS = 1_200;
const DEFAULT_DESTINATION_RADIUS_METERS = 1_800;
const DEFAULT_MAX_DETOUR_METERS = 300;
const MIN_ETA_SECONDS = 60;
const AVERAGE_CITY_DRIVE_METERS_PER_SECOND = 9;

function toFiniteNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeCoordinate(point) {
  if (!point || typeof point !== 'object') {
    return null;
  }

  const latitude = toFiniteNumber(point.latitude);
  const longitude = toFiniteNumber(point.longitude);

  if (latitude == null || longitude == null) {
    return null;
  }

  return { latitude, longitude };
}

function normalizePathPoints(pathPoints) {
  if (!Array.isArray(pathPoints)) {
    return [];
  }

  return pathPoints
    .map((point) => normalizeCoordinate(point))
    .filter((point) => point != null);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(a, b) {
  if (!a || !b) {
    return null;
  }

  const earthRadiusMeters = 6_371_000;
  const latDistance = toRadians(b.latitude - a.latitude);
  const lngDistance = toRadians(b.longitude - a.longitude);

  const startLat = toRadians(a.latitude);
  const endLat = toRadians(b.latitude);

  const h =
    Math.sin(latDistance / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDistance / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function findNearestPointIndex(point, pathPoints) {
  if (!point || pathPoints.length === 0) {
    return -1;
  }

  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < pathPoints.length; index += 1) {
    const candidate = pathPoints[index];
    const distance = haversineDistanceMeters(point, candidate);

    if (distance != null && distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function nearestDistanceToPath(point, pathPoints) {
  const nearestIndex = findNearestPointIndex(point, pathPoints);

  if (nearestIndex < 0) {
    return null;
  }

  return haversineDistanceMeters(point, pathPoints[nearestIndex]);
}

function insertWaypoint(pathPoints, waypoint) {
  if (!waypoint || pathPoints.length === 0) {
    return pathPoints;
  }

  const nearestIndex = findNearestPointIndex(waypoint, pathPoints);

  if (nearestIndex < 0) {
    return [...pathPoints, waypoint];
  }

  const nextPath = [...pathPoints];
  nextPath.splice(nearestIndex + 1, 0, waypoint);
  return nextPath;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function interpolateCurrentLocation(pathPoints, startedAtIso, completedAtIso) {
  if (pathPoints.length === 0) {
    return null;
  }

  if (pathPoints.length === 1) {
    return pathPoints[0];
  }

  const startedAtMs = new Date(startedAtIso).getTime();
  const completedAtMs = new Date(completedAtIso).getTime();
  const nowMs = Date.now();

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs) || completedAtMs <= startedAtMs) {
    return pathPoints[0];
  }

  const progress = clamp((nowMs - startedAtMs) / (completedAtMs - startedAtMs), 0, 1);
  const index = Math.round(progress * (pathPoints.length - 1));

  return pathPoints[index];
}

function estimateCurrentLocation(tripStatus, metadata, pathPoints, startedAtIso, completedAtIso) {
  const liveCoordinate = normalizeCoordinate(metadata?.liveLocation);

  if (liveCoordinate) {
    return liveCoordinate;
  }

  if (tripStatus !== 'active') {
    return pathPoints[0] ?? null;
  }

  return interpolateCurrentLocation(pathPoints, startedAtIso, completedAtIso);
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function calculateEtaSeconds(distanceMeters, startedAtIso, tripStatus) {
  if (distanceMeters == null) {
    return null;
  }

  const driveSeconds = Math.max(Math.round(distanceMeters / AVERAGE_CITY_DRIVE_METERS_PER_SECOND), MIN_ETA_SECONDS);

  if (tripStatus !== 'scheduled') {
    return driveSeconds;
  }

  const startOffsetSeconds = Math.max(
    Math.round((new Date(startedAtIso).getTime() - Date.now()) / 1_000),
    0
  );

  return driveSeconds + startOffsetSeconds;
}

function mapCarpoolRow(row, options) {
  const {
    source,
    destination,
    sourceRadiusMeters = DEFAULT_SOURCE_RADIUS_METERS,
    destinationRadiusMeters = DEFAULT_DESTINATION_RADIUS_METERS,
    userId,
  } = options;
  const metadata = normalizeMetadata(row.metadata);
  const pathPoints = normalizePathPoints(row.path_points);
  const currentLocation = estimateCurrentLocation(
    row.status,
    metadata,
    pathPoints,
    row.started_at,
    row.completed_at
  );
  const acceptedCount = Number(row.accepted_count ?? 0);
  const pendingCount = Number(row.pending_count ?? 0);
  const baseAvailableSeats = Number(row.available_seats ?? 0);
  const remainingSeats = Math.max(baseAvailableSeats, 0);
  const sourceDistanceMeters = source
    ? row.status === 'active'
      ? haversineDistanceMeters(currentLocation, source)
      : nearestDistanceToPath(source, pathPoints)
    : null;
  const destinationDistanceMeters = destination ? nearestDistanceToPath(destination, pathPoints) : null;

  if (source && sourceDistanceMeters != null && sourceDistanceMeters > sourceRadiusMeters) {
    return null;
  }

  if (destination && destinationDistanceMeters != null && destinationDistanceMeters > destinationRadiusMeters) {
    return null;
  }

  const myRequest =
    row.my_request_id == null
      ? null
      : {
          id: row.my_request_id,
          status: row.my_request_status,
          etaSeconds: row.my_request_eta_seconds,
          routeAdjustment:
            row.my_request_route_adjustment &&
            typeof row.my_request_route_adjustment === 'object' &&
            !Array.isArray(row.my_request_route_adjustment)
              ? row.my_request_route_adjustment
              : {},
          createdAt: row.my_request_created_at,
          respondedAt: row.my_request_responded_at,
        };

  if (remainingSeats <= 0 && myRequest == null) {
    return null;
  }

  const sourceDistance = sourceDistanceMeters == null ? null : Number(sourceDistanceMeters.toFixed(1));
  const destinationDistance =
    destinationDistanceMeters == null ? null : Number(destinationDistanceMeters.toFixed(1));

  const etaToSourceSeconds =
    row.status === 'active' && sourceDistanceMeters != null
      ? calculateEtaSeconds(sourceDistanceMeters, row.started_at, row.status)
      : null;

  return {
    id: row.id,
    hostId: row.user_id,
    hostName: row.host_name,
    routeType: row.route_type,
    routeTitle: row.route_title,
    originLabel: row.origin_label,
    destinationLabel: row.destination_label,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    availableSeats: baseAvailableSeats,
    remainingSeats,
    acceptedCount,
    pendingCount,
    status: row.status,
    startsAt: row.started_at,
    endsAt: row.completed_at,
    sourceDistanceMeters: sourceDistance,
    destinationDistanceMeters: destinationDistance,
    etaToSourceSeconds,
    currentLocation,
    pathPoints,
    pricePerMile: toFiniteNumber(metadata.pricePerMile) ?? 0,
    maxDetourMeters: toFiniteNumber(metadata.maxDetourMeters) ?? DEFAULT_MAX_DETOUR_METERS,
    vehicleLabel: typeof metadata.vehicleLabel === 'string' ? metadata.vehicleLabel : null,
    notes: typeof metadata.notes === 'string' ? metadata.notes : null,
    myRequest,
    isHostedByCurrentUser: userId === row.user_id,
  };
}

function mapCarpoolRequestRow(row) {
  return {
    id: row.id,
    carpoolId: row.trip_id,
    hostId: row.host_id,
    hostName: row.host_name,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    status: row.status,
    pickupLabel: row.pickup_label,
    pickupPoint: normalizeCoordinate(row.pickup_point),
    dropoffLabel: row.dropoff_label,
    dropoffPoint: normalizeCoordinate(row.dropoff_point),
    etaSeconds: row.eta_seconds == null ? null : Number(row.eta_seconds),
    routeAdjustment:
      row.route_adjustment && typeof row.route_adjustment === 'object' ? row.route_adjustment : {},
    message: row.message ?? null,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    carpool: {
      id: row.trip_id,
      routeTitle: row.route_title,
      originLabel: row.origin_label,
      destinationLabel: row.destination_label,
      status: row.trip_status,
      startsAt: row.started_at,
      endsAt: row.completed_at,
    },
  };
}

function buildCarpoolBaseQuery(whereClause) {
  return `
    SELECT
      trips.*,
      profiles.user_name AS host_name,
      COALESCE(request_counts.accepted_count, 0)::INTEGER AS accepted_count,
      COALESCE(request_counts.pending_count, 0)::INTEGER AS pending_count,
      my_request.id AS my_request_id,
      my_request.status AS my_request_status,
      my_request.eta_seconds AS my_request_eta_seconds,
      my_request.route_adjustment AS my_request_route_adjustment,
      my_request.created_at AS my_request_created_at,
      my_request.responded_at AS my_request_responded_at
    FROM trips
    INNER JOIN profiles ON profiles.id = trips.user_id
    LEFT JOIN (
      SELECT
        trip_id,
        COUNT(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
        COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending_count
      FROM carpool_requests
      GROUP BY trip_id
    ) AS request_counts ON request_counts.trip_id = trips.id
    LEFT JOIN LATERAL (
      SELECT
        id,
        status,
        eta_seconds,
        route_adjustment,
        created_at,
        responded_at
      FROM carpool_requests
      WHERE trip_id = trips.id
        AND requester_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    ) AS my_request ON TRUE
    ${whereClause}
  `;
}

async function getCarpoolById(carpoolId, userId, db = pool) {
  const result = await db.query(
    buildCarpoolBaseQuery(`
      WHERE trips.id = $2
        AND trips.status = ANY($3::text[])
        AND trips.route_type = ANY($4::text[])
      LIMIT 1
    `),
    [userId, carpoolId, DISCOVERY_STATUSES, CARPOOL_ROUTE_TYPES]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapCarpoolRow(result.rows[0], {
    userId,
    source: null,
    destination: null,
  });
}

async function listNearbyCarpools({
  userId,
  source,
  destination = null,
  sourceRadiusMeters = DEFAULT_SOURCE_RADIUS_METERS,
  destinationRadiusMeters = DEFAULT_DESTINATION_RADIUS_METERS,
}) {
  const result = await pool.query(
    buildCarpoolBaseQuery(`
      WHERE trips.status = ANY($2::text[])
        AND trips.route_type = ANY($3::text[])
      ORDER BY
        CASE trips.status
          WHEN 'active' THEN 0
          WHEN 'scheduled' THEN 1
          ELSE 2
        END,
        trips.started_at ASC,
        trips.id DESC
    `),
    [userId, DISCOVERY_STATUSES, CARPOOL_ROUTE_TYPES]
  );

  const mappedCarpools = result.rows
    .map((row) =>
      mapCarpoolRow(row, {
        userId,
        source,
        destination,
        sourceRadiusMeters,
        destinationRadiusMeters,
      })
    )
    .filter((carpool) => carpool != null);

  const hosted = mappedCarpools
    .filter((carpool) => carpool.isHostedByCurrentUser)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const live = mappedCarpools
    .filter((carpool) => carpool.status === 'active' && !carpool.isHostedByCurrentUser)
    .sort((a, b) => (a.sourceDistanceMeters ?? Number.POSITIVE_INFINITY) - (b.sourceDistanceMeters ?? Number.POSITIVE_INFINITY));
  const scheduled = mappedCarpools
    .filter((carpool) => carpool.status === 'scheduled' && !carpool.isHostedByCurrentUser)
    .sort((a, b) => (a.sourceDistanceMeters ?? Number.POSITIVE_INFINITY) - (b.sourceDistanceMeters ?? Number.POSITIVE_INFINITY));

  return {
    sourceRadiusMeters,
    destinationRadiusMeters,
    hosted,
    live,
    scheduled,
    generatedAt: new Date().toISOString(),
  };
}

function estimateCarpoolCo2Kg(distanceMeters) {
  const distanceKm = Math.max(distanceMeters, 0) / 1_000;
  return Number((distanceKm * 0.174).toFixed(3));
}

function estimateCarpoolCo2SavedKg(distanceMeters, availableSeats) {
  const distanceKm = Math.max(distanceMeters, 0) / 1_000;
  const occupancyMultiplier = Math.max(availableSeats, 1);
  return Number((distanceKm * occupancyMultiplier * 0.06).toFixed(3));
}

async function createCarpool({
  hostId,
  displayName,
  routeTitle,
  originLabel,
  destinationLabel,
  distanceMeters,
  durationSeconds,
  availableSeats,
  startsAt,
  endsAt,
  status,
  pathPoints,
  pricePerMile,
  maxDetourMeters,
  vehicleLabel = null,
  notes = null,
  metadata = {},
}) {
  const normalizedPathPoints = normalizePathPoints(pathPoints);
  const now = new Date();
  const normalizedStartsAt = new Date(startsAt);
  const normalizedEndsAt = new Date(endsAt);
  const startsAtIso = Number.isNaN(normalizedStartsAt.getTime())
    ? now.toISOString()
    : normalizedStartsAt.toISOString();
  const endsAtIso = Number.isNaN(normalizedEndsAt.getTime())
    ? new Date(now.getTime() + Math.max(durationSeconds, 60) * 1_000).toISOString()
    : normalizedEndsAt.toISOString();
  const metadataPayload = {
    ...metadata,
    carpool: true,
    pricePerMile,
    maxDetourMeters,
    vehicleLabel,
    notes,
    createdFrom: 'carpool-tab',
  };

  const savedTrip = await createTripRecord({
    userId: hostId,
    displayName,
    routeType: 'carpool',
    routeTitle,
    originLabel,
    destinationLabel,
    distanceMeters,
    durationSeconds,
    co2Kg: estimateCarpoolCo2Kg(distanceMeters),
    co2SavedKg: estimateCarpoolCo2SavedKg(distanceMeters, availableSeats),
    availableSeats,
    status,
    startedAt: startsAtIso,
    completedAt: endsAtIso,
    pathPoints:
      normalizedPathPoints.length >= 2 ? normalizedPathPoints : [normalizedPathPoints[0], normalizedPathPoints[0]].filter(Boolean),
    metadata: metadataPayload,
  });

  await pool.query(
    `
      INSERT INTO trip_users (trip_id, driver_id, rider_id)
      VALUES ($1, $2, $2)
      ON CONFLICT (trip_id, rider_id) DO NOTHING
    `,
    [savedTrip.id, hostId]
  );

  const createdCarpool = await getCarpoolById(savedTrip.id, hostId);

  if (!createdCarpool) {
    throw new Error('Carpool was created but could not be loaded.');
  }

  return createdCarpool;
}

function buildRequestJoinQuery(whereClause) {
  return `
    SELECT
      carpool_requests.*,
      trips.route_title,
      trips.origin_label,
      trips.destination_label,
      trips.status AS trip_status,
      trips.started_at,
      trips.completed_at,
      host_profile.user_name AS host_name,
      requester_profile.user_name AS requester_name
    FROM carpool_requests
    INNER JOIN trips ON trips.id = carpool_requests.trip_id
    INNER JOIN profiles AS host_profile ON host_profile.id = carpool_requests.host_id
    INNER JOIN profiles AS requester_profile ON requester_profile.id = carpool_requests.requester_id
    ${whereClause}
  `;
}

async function getCarpoolRequestsForSender(userId) {
  const result = await pool.query(
    buildRequestJoinQuery(`
      WHERE carpool_requests.requester_id = $1
      ORDER BY carpool_requests.created_at DESC, carpool_requests.id DESC
    `),
    [userId]
  );

  return result.rows.map(mapCarpoolRequestRow);
}

async function getCarpoolRequestsForHost(userId) {
  const result = await pool.query(
    buildRequestJoinQuery(`
      WHERE carpool_requests.host_id = $1
      ORDER BY
        CASE carpool_requests.status
          WHEN 'pending' THEN 0
          WHEN 'accepted' THEN 1
          WHEN 'rejected' THEN 2
          ELSE 3
        END,
        carpool_requests.created_at DESC
    `),
    [userId]
  );

  return result.rows.map(mapCarpoolRequestRow);
}

async function loadRequestForUpdate(client, requestId) {
  const result = await client.query(
    `
      SELECT
        carpool_requests.*,
        trips.route_title,
        trips.origin_label,
        trips.destination_label,
        trips.path_points,
        trips.metadata AS trip_metadata,
        trips.status AS trip_status,
        trips.started_at,
        trips.completed_at,
        trips.available_seats,
        trips.user_id AS trip_host_id,
        host_profile.user_name AS host_name,
        requester_profile.user_name AS requester_name,
        COALESCE(request_counts.accepted_count, 0)::INTEGER AS accepted_count
      FROM carpool_requests
      INNER JOIN trips ON trips.id = carpool_requests.trip_id
      INNER JOIN profiles AS host_profile ON host_profile.id = carpool_requests.host_id
      INNER JOIN profiles AS requester_profile ON requester_profile.id = carpool_requests.requester_id
      LEFT JOIN (
        SELECT
          trip_id,
          COUNT(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count
        FROM carpool_requests
        GROUP BY trip_id
      ) AS request_counts ON request_counts.trip_id = carpool_requests.trip_id
      WHERE carpool_requests.id = $1
      FOR UPDATE OF carpool_requests, trips
    `,
    [requestId]
  );

  return result.rows[0] ?? null;
}

async function reloadRequestById(requestId, db = pool) {
  const result = await db.query(
    buildRequestJoinQuery(`
      WHERE carpool_requests.id = $1
      LIMIT 1
    `),
    [requestId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapCarpoolRequestRow(result.rows[0]);
}

async function resolveCarpoolRequestInTransaction({
  client,
  requestId,
  hostId,
  status,
  message = null,
}) {
  const requestRow = await loadRequestForUpdate(client, requestId);

  if (!requestRow) {
    throw new Error(`Carpool request ${requestId} was not found.`);
  }

  if (requestRow.host_id !== hostId || requestRow.trip_host_id !== hostId) {
    throw new Error('Only the carpool host can respond to this request.');
  }

  if (requestRow.status !== 'pending') {
    const existingRequest = await reloadRequestById(requestId, client);
    if (!existingRequest) {
      throw new Error(`Carpool request ${requestId} was not found.`);
    }
    return existingRequest;
  }

  const responseTimestamp = new Date().toISOString();

  if (status === 'accepted') {
    const remainingSeats = Math.max(Number(requestRow.available_seats), 0);

    if (remainingSeats <= 0) {
      throw new Error('No seats are left in this carpool.');
    }

    const tripMetadata = normalizeMetadata(requestRow.trip_metadata);
    const maxDetourMeters = toFiniteNumber(tripMetadata.maxDetourMeters) ?? DEFAULT_MAX_DETOUR_METERS;
    const pickupPoint = normalizeCoordinate(requestRow.pickup_point);
    const dropoffPoint = normalizeCoordinate(requestRow.dropoff_point);
    const pathPoints = normalizePathPoints(requestRow.path_points);

    const pickupDistanceMeters = pickupPoint ? nearestDistanceToPath(pickupPoint, pathPoints) : null;
    const dropoffDistanceMeters = dropoffPoint ? nearestDistanceToPath(dropoffPoint, pathPoints) : null;

    if (pickupDistanceMeters != null && pickupDistanceMeters > maxDetourMeters) {
      throw new Error(
        `Pickup exceeds host detour limit (${Math.round(maxDetourMeters)}m). Ask the rider to choose a closer pickup point.`
      );
    }

    const insertedStops = [];
    let adjustedPath = [...pathPoints];

    if (pickupPoint && pickupDistanceMeters != null && pickupDistanceMeters > 50) {
      adjustedPath = insertWaypoint(adjustedPath, pickupPoint);
      insertedStops.push('pickup');
    }

    if (dropoffPoint && dropoffDistanceMeters != null && dropoffDistanceMeters > 50) {
      adjustedPath = insertWaypoint(adjustedPath, dropoffPoint);
      insertedStops.push('dropoff');
    }

    const currentLocation = estimateCurrentLocation(
      requestRow.trip_status,
      tripMetadata,
      adjustedPath,
      requestRow.started_at,
      requestRow.completed_at
    );
    const distanceToPickupMeters = pickupPoint ? haversineDistanceMeters(currentLocation, pickupPoint) : null;
    const etaSeconds = calculateEtaSeconds(distanceToPickupMeters, requestRow.started_at, requestRow.trip_status);
    const routeAdjustment = {
      adjustedAt: responseTimestamp,
      insertedStops,
      pickupDetourMeters: pickupDistanceMeters == null ? null : Number(pickupDistanceMeters.toFixed(1)),
      dropoffDetourMeters: dropoffDistanceMeters == null ? null : Number(dropoffDistanceMeters.toFixed(1)),
      maxDetourMeters,
      rideStatus: 'waiting_pickup',
      progressUpdatedAt: responseTimestamp,
    };
    const nextTripMetadata = {
      ...tripMetadata,
      lastRouteAdjustment: routeAdjustment,
      acceptedRequests: Number(requestRow.accepted_count) + 1,
    };

    await client.query(
      `
        UPDATE trips
        SET
          available_seats = GREATEST(available_seats - 1, 0),
          path_points = $2::jsonb,
          metadata = $3::jsonb
        WHERE id = $1
      `,
      [requestRow.trip_id, JSON.stringify(adjustedPath), JSON.stringify(nextTripMetadata)]
    );

    await client.query(
      `
        UPDATE carpool_requests
        SET
          status = 'accepted',
          responded_at = $2,
          eta_seconds = $3,
          route_adjustment = $4::jsonb,
          message = $5
        WHERE id = $1
      `,
      [requestId, responseTimestamp, etaSeconds, JSON.stringify(routeAdjustment), message]
    );

    await client.query(
      `
        INSERT INTO trip_users (trip_id, driver_id, rider_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (trip_id, rider_id) DO NOTHING
      `,
      [requestRow.trip_id, hostId, requestRow.requester_id]
    );
  } else {
    await client.query(
      `
        UPDATE carpool_requests
        SET
          status = $2,
          responded_at = $3,
          eta_seconds = NULL,
          route_adjustment = '{}'::jsonb,
          message = $4
        WHERE id = $1
      `,
      [requestId, status, responseTimestamp, message]
    );
  }

  const updatedRequest = await reloadRequestById(requestId, client);

  if (!updatedRequest) {
    throw new Error('Failed to reload updated carpool request.');
  }

  return updatedRequest;
}

async function createCarpoolRequest({
  carpoolId,
  requesterId,
  pickupLabel,
  pickupPoint,
  dropoffLabel,
  dropoffPoint,
  message = null,
  autoApprove = false,
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const carpoolResult = await client.query(
      `
        SELECT
          trips.id,
          trips.user_id AS host_id,
          trips.status,
          trips.available_seats,
          COALESCE(request_counts.accepted_count, 0)::INTEGER AS accepted_count
        FROM trips
        LEFT JOIN (
          SELECT
            trip_id,
            COUNT(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count
          FROM carpool_requests
          GROUP BY trip_id
        ) AS request_counts ON request_counts.trip_id = trips.id
        WHERE trips.id = $1
          AND trips.status = ANY($2::text[])
          AND trips.route_type = ANY($3::text[])
        FOR UPDATE OF trips
      `,
      [carpoolId, DISCOVERY_STATUSES, CARPOOL_ROUTE_TYPES]
    );

    if (carpoolResult.rowCount === 0) {
      throw new Error(`Carpool ${carpoolId} is not available.`);
    }

    const carpool = carpoolResult.rows[0];

    if (carpool.host_id === requesterId) {
      throw new Error('Hosts cannot request their own carpools.');
    }

    const remainingSeats = Math.max(Number(carpool.available_seats), 0);

    if (remainingSeats <= 0) {
      throw new Error('No seats are left in this carpool.');
    }

    const existingRequestResult = await client.query(
      `
        SELECT id, status
        FROM carpool_requests
        WHERE trip_id = $1
          AND requester_id = $2
        FOR UPDATE
      `,
      [carpoolId, requesterId]
    );

    let requestId;

    if (existingRequestResult.rowCount > 0) {
      const existingRequest = existingRequestResult.rows[0];

      if (existingRequest.status === 'pending' || existingRequest.status === 'accepted') {
        requestId = existingRequest.id;
      } else {
        await client.query(
          `
            UPDATE carpool_requests
            SET
              status = 'pending',
              pickup_label = $2,
              pickup_point = $3::jsonb,
              dropoff_label = $4,
              dropoff_point = $5::jsonb,
              eta_seconds = NULL,
              route_adjustment = '{}'::jsonb,
              message = $6,
              created_at = NOW(),
              responded_at = NULL
            WHERE id = $1
          `,
          [
            existingRequest.id,
            pickupLabel,
            JSON.stringify(pickupPoint),
            dropoffLabel,
            JSON.stringify(dropoffPoint),
            message,
          ]
        );
        requestId = existingRequest.id;
      }
    } else {
      const requestResult = await client.query(
        `
          INSERT INTO carpool_requests (
            trip_id,
            host_id,
            requester_id,
            pickup_label,
            pickup_point,
            dropoff_label,
            dropoff_point,
            status,
            message
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'pending', $8)
          RETURNING id
        `,
        [
          carpoolId,
          carpool.host_id,
          requesterId,
          pickupLabel,
          JSON.stringify(pickupPoint),
          dropoffLabel,
          JSON.stringify(dropoffPoint),
          message,
        ]
      );
      requestId = requestResult.rows[0].id;
    }

    let finalRequest;

    if (autoApprove) {
      finalRequest = await resolveCarpoolRequestInTransaction({
        client,
        requestId,
        hostId: carpool.host_id,
        status: 'accepted',
        message: message ?? 'Auto-approved by host rules.',
      });
    } else {
      finalRequest = await reloadRequestById(requestId, client);

      if (!finalRequest) {
        throw new Error('Carpool request was created but could not be loaded.');
      }
    }

    await client.query('COMMIT');
    return finalRequest;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function respondToCarpoolRequest({ requestId, hostId, status, message = null }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const updatedRequest = await resolveCarpoolRequestInTransaction({
      client,
      requestId,
      hostId,
      status,
      message,
    });
    await client.query('COMMIT');
    return updatedRequest;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateCarpoolRequestProgress({
  requestId,
  hostId,
  rideStatus,
  etaSeconds = null,
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const requestRow = await loadRequestForUpdate(client, requestId);

    if (!requestRow) {
      throw new Error(`Carpool request ${requestId} was not found.`);
    }

    if (requestRow.host_id !== hostId || requestRow.trip_host_id !== hostId) {
      throw new Error('Only the carpool host can update rider progress.');
    }

    if (requestRow.status !== 'accepted') {
      throw new Error('Only accepted carpool requests can receive progress updates.');
    }

    const nowIso = new Date().toISOString();
    const existingRouteAdjustment =
      requestRow.route_adjustment &&
      typeof requestRow.route_adjustment === 'object' &&
      !Array.isArray(requestRow.route_adjustment)
        ? requestRow.route_adjustment
        : {};
    const nextRouteAdjustment = {
      ...existingRouteAdjustment,
      rideStatus,
      progressUpdatedAt: nowIso,
      ...(rideStatus === 'onboard' && !existingRouteAdjustment.boardedAt ? { boardedAt: nowIso } : {}),
      ...(rideStatus === 'dropped_off'
        ? {
            boardedAt: existingRouteAdjustment.boardedAt ?? nowIso,
            droppedOffAt: nowIso,
          }
        : {}),
    };
    const resolvedEtaSeconds =
      etaSeconds == null
        ? rideStatus === 'dropped_off'
          ? 0
          : requestRow.eta_seconds
        : Math.max(Math.round(Number(etaSeconds)), 0);

    await client.query(
      `
        UPDATE carpool_requests
        SET
          route_adjustment = $2::jsonb,
          eta_seconds = $3
        WHERE id = $1
      `,
      [requestId, JSON.stringify(nextRouteAdjustment), resolvedEtaSeconds]
    );

    const updatedRequest = await reloadRequestById(requestId, client);

    if (!updatedRequest) {
      throw new Error(`Carpool request ${requestId} was not found.`);
    }

    await client.query('COMMIT');
    return updatedRequest;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createCarpool,
  createCarpoolRequest,
  getCarpoolById,
  getCarpoolRequestsForHost,
  getCarpoolRequestsForSender,
  listNearbyCarpools,
  respondToCarpoolRequest,
  updateCarpoolRequestProgress,
};
