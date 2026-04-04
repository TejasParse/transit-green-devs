const cors = require('cors');
const dotenv = require('dotenv');
const express = require('express');
const { Pool } = require('pg');
const { ensureSchema } = require('./db/schema');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/innovationhacks';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

const GOOGLE_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const GOOGLE_PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const PHOENIX_BOUNDS = {
  north: 33.95,
  south: 32.95,
  east: -111.25,
  west: -112.75,
};
const PHOENIX_CENTER = {
  latitude: 33.4484,
  longitude: -112.074,
};
const FALLBACK_CARBON_GRAMS_PER_KM = 250.5847;
const GASOLINE_KG_CO2_PER_LITER = 2.31;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

app.use(
  cors({
    origin: true,
  })
);
app.use(express.json({ limit: '1mb' }));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function ensureGoogleApiKey() {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new HttpError(
      500,
      'Missing GOOGLE_MAPS_API_KEY. Add it to server/.env before using Places or Routes.'
    );
  }
}

function parseDurationSeconds(duration) {
  if (typeof duration !== 'string') {
    return 0;
  }

  return Math.round(Number.parseFloat(duration.replace('s', '')) || 0);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeCoordinate(input, label) {
  const latitude = Number(input?.latitude);
  const longitude = Number(input?.longitude);

  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    throw new HttpError(400, `${label} must include numeric latitude and longitude values.`);
  }

  return { latitude, longitude };
}

function isWithinPhoenix(coordinate) {
  return (
    coordinate.latitude >= PHOENIX_BOUNDS.south &&
    coordinate.latitude <= PHOENIX_BOUNDS.north &&
    coordinate.longitude >= PHOENIX_BOUNDS.west &&
    coordinate.longitude <= PHOENIX_BOUNDS.east
  );
}

function assertWithinPhoenix(coordinate, label) {
  if (!isWithinPhoenix(coordinate)) {
    throw new HttpError(400, `${label} must stay within the Greater Phoenix area.`);
  }
}

function sanitizeRoutePath(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new HttpError(400, 'A route path with at least two points is required.');
  }

  return points.map((point, index) => {
    const coordinate = normalizeCoordinate(point, `Route point ${index + 1}`);
    assertWithinPhoenix(coordinate, `Route point ${index + 1}`);
    return coordinate;
  });
}

function decodePolyline(encoded) {
  if (!encoded) {
    return [];
  }

  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return coordinates;
}

function estimateCarbonKg(distanceMeters, fuelConsumptionLiters) {
  if (isFiniteNumber(fuelConsumptionLiters) && fuelConsumptionLiters > 0) {
    return Number((fuelConsumptionLiters * GASOLINE_KG_CO2_PER_LITER).toFixed(2));
  }

  const estimated = (distanceMeters / 1000) * (FALLBACK_CARBON_GRAMS_PER_KM / 1000);
  return Number(estimated.toFixed(2));
}

function serializeTrip(row) {
  return {
    id: Number(row.id),
    status: row.status,
    originName: row.origin_name,
    origin: {
      latitude: row.origin_lat,
      longitude: row.origin_lng,
    },
    destinationName: row.destination_name,
    destination: {
      latitude: row.destination_lat,
      longitude: row.destination_lng,
    },
    routeKind: row.route_kind,
    routeLabels: row.route_labels || [],
    routePath: row.route_path || [],
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    actualDurationSeconds: row.actual_duration_seconds,
    estimatedCarbonKg: row.estimated_carbon_kg,
    fuelConsumptionLiters: row.fuel_consumption_liters,
    startedAt: row.started_at?.toISOString?.() || row.started_at,
    endedAt: row.ended_at?.toISOString?.() || row.ended_at,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
  };
}

async function googleFetchJson(url, { method = 'POST', body, fieldMask } = {}) {
  ensureGoogleApiKey();

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const rawText = await response.text();
  const payload = rawText ? JSON.parse(rawText) : {};

  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.message || 'Google Maps Platform request failed.';
    throw new HttpError(response.status, message);
  }

  return payload;
}

function buildRoutePlan(route, origin, destination) {
  const routePath = decodePolyline(route?.polyline?.encodedPolyline || '');
  const fuelConsumptionLiters = isFiniteNumber(route?.travelAdvisory?.fuelConsumptionMicroliters)
    ? Number((route.travelAdvisory.fuelConsumptionMicroliters / 1_000_000).toFixed(2))
    : null;
  const distanceMeters = Number(route?.distanceMeters || 0);
  const routeLabels = Array.isArray(route?.routeLabels) ? route.routeLabels : [];
  const routeKind = routeLabels.includes('FUEL_EFFICIENT') ? 'eco' : 'best-available';

  return {
    origin,
    destination,
    routeKind,
    routeLabels,
    distanceMeters,
    durationSeconds: parseDurationSeconds(route?.duration),
    routePath: routePath.length >= 2 ? routePath : [origin, destination],
    fuelConsumptionLiters,
    estimatedCarbonKg: estimateCarbonKg(distanceMeters, fuelConsumptionLiters),
  };
}

function selectBestRoute(routes, origin, destination) {
  const preferredRoute =
    routes.find((route) => Array.isArray(route.routeLabels) && route.routeLabels.includes('FUEL_EFFICIENT')) ||
    routes.reduce((lowestFuelRoute, currentRoute) => {
      const currentFuel = currentRoute?.travelAdvisory?.fuelConsumptionMicroliters;

      if (!isFiniteNumber(currentFuel)) {
        return lowestFuelRoute;
      }

      if (!lowestFuelRoute) {
        return currentRoute;
      }

      const lowestFuel = lowestFuelRoute?.travelAdvisory?.fuelConsumptionMicroliters;
      return currentFuel < lowestFuel ? currentRoute : lowestFuelRoute;
    }, null) ||
    routes[0];

  return buildRoutePlan(preferredRoute, origin, destination);
}

async function computeRoutePlan(origin, destination, preferEcoRoute) {
  const baseRequest = {
    origin: {
      location: {
        latLng: {
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
      },
    },
    travelMode: 'DRIVE',
    polylineQuality: 'OVERVIEW',
    polylineEncoding: 'ENCODED_POLYLINE',
    languageCode: 'en-US',
    units: 'IMPERIAL',
    routingPreference: preferEcoRoute ? 'TRAFFIC_AWARE_OPTIMAL' : 'TRAFFIC_AWARE',
  };

  const ecoRequest = preferEcoRoute
    ? {
        ...baseRequest,
        extraComputations: ['FUEL_CONSUMPTION'],
        requestedReferenceRoutes: ['FUEL_EFFICIENT'],
        routeModifiers: {
          vehicleInfo: {
            emissionType: 'GASOLINE',
          },
        },
      }
    : baseRequest;

  const response = await googleFetchJson(GOOGLE_ROUTES_URL, {
    body: ecoRequest,
    fieldMask:
      'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.routeLabels,routes.travelAdvisory.fuelConsumptionMicroliters',
  });

  const routes = Array.isArray(response?.routes) ? response.routes : [];
  if (routes.length === 0) {
    throw new HttpError(502, 'No drivable route was returned for this trip.');
  }

  return selectBestRoute(routes, origin, destination);
}

async function initializeDatabase() {
  await ensureSchema(pool);
}

app.get('/api/health', async (_request, response) => {
  const { rows } = await pool.query('SELECT NOW() AS now');
  response.json({
    ok: true,
    now: rows[0]?.now,
    phoenixBounds: PHOENIX_BOUNDS,
    phoenixCenter: PHOENIX_CENTER,
  });
});

app.get('/api/places/autocomplete', async (request, response) => {
  const query = String(request.query.q || '').trim();

  if (query.length < 2) {
    response.json({ suggestions: [] });
    return;
  }

  const payload = await googleFetchJson(GOOGLE_AUTOCOMPLETE_URL, {
    body: {
      input: query,
      includedRegionCodes: ['us'],
      includeQueryPredictions: false,
      locationRestriction: {
        rectangle: {
          low: {
            latitude: PHOENIX_BOUNDS.south,
            longitude: PHOENIX_BOUNDS.west,
          },
          high: {
            latitude: PHOENIX_BOUNDS.north,
            longitude: PHOENIX_BOUNDS.east,
          },
        },
      },
    },
    fieldMask:
      'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
  });

  const suggestions = (payload.suggestions || [])
    .map((item) => item.placePrediction)
    .filter(Boolean)
    .map((prediction) => ({
      placeId: prediction.placeId,
      mainText:
        prediction.structuredFormat?.mainText?.text || prediction.text?.text || 'Unknown place',
      secondaryText: prediction.structuredFormat?.secondaryText?.text || '',
      fullText: prediction.text?.text || '',
    }))
    .slice(0, 6);

  response.json({ suggestions });
});

app.get('/api/places/:placeId', async (request, response) => {
  const placeId = encodeURIComponent(request.params.placeId);
  const payload = await googleFetchJson(`${GOOGLE_PLACE_DETAILS_URL}/${placeId}?languageCode=en`, {
    method: 'GET',
    fieldMask: 'id,displayName.text,formattedAddress,location',
  });

  const coordinate = normalizeCoordinate(payload.location, 'Destination');
  assertWithinPhoenix(coordinate, 'Destination');

  response.json({
    placeId: payload.id || request.params.placeId,
    name: payload.displayName?.text || payload.formattedAddress || 'Phoenix destination',
    address: payload.formattedAddress || '',
    coordinate,
  });
});

app.post('/api/routes/plan', async (request, response) => {
  const origin = normalizeCoordinate(request.body?.origin, 'Origin');
  const destination = normalizeCoordinate(request.body?.destination, 'Destination');

  assertWithinPhoenix(origin, 'Origin');
  assertWithinPhoenix(destination, 'Destination');

  try {
    const route = await computeRoutePlan(origin, destination, true);
    response.json({ route });
  } catch (error) {
    const fallbackRoute = await computeRoutePlan(origin, destination, false);
    response.json({
      route: {
        ...fallbackRoute,
        routeKind: fallbackRoute.routeKind === 'eco' ? 'eco' : 'best-available',
      },
      routeFallback: error.message,
    });
  }
});

app.get('/api/trips', async (_request, response) => {
  const { rows } = await pool.query(`
    SELECT *
    FROM trips
    ORDER BY started_at DESC
    LIMIT 50
  `);

  response.json({
    trips: rows.map(serializeTrip),
  });
});

app.post('/api/trips', async (request, response) => {
  const origin = normalizeCoordinate(request.body?.origin, 'Origin');
  const destination = normalizeCoordinate(request.body?.destination, 'Destination');
  const routePath = sanitizeRoutePath(request.body?.routePath);
  const routeKind = String(request.body?.routeKind || 'best-available');
  const routeLabels = Array.isArray(request.body?.routeLabels) ? request.body.routeLabels : [];
  const distanceMeters = Number(request.body?.distanceMeters);
  const durationSeconds = Number(request.body?.durationSeconds);
  const estimatedCarbonKg = Number(request.body?.estimatedCarbonKg);
  const fuelConsumptionLiters =
    request.body?.fuelConsumptionLiters == null ? null : Number(request.body.fuelConsumptionLiters);
  const originName = String(request.body?.originName || 'Current location');
  const destinationName = String(request.body?.destinationName || 'Destination');
  const startedAt = new Date(request.body?.startedAt || new Date().toISOString());

  assertWithinPhoenix(origin, 'Origin');
  assertWithinPhoenix(destination, 'Destination');

  if (!isFiniteNumber(distanceMeters) || !isFiniteNumber(durationSeconds) || !isFiniteNumber(estimatedCarbonKg)) {
    throw new HttpError(400, 'Trip metrics are missing or invalid.');
  }

  if (Number.isNaN(startedAt.getTime())) {
    throw new HttpError(400, 'startedAt must be a valid ISO timestamp.');
  }

  const { rows } = await pool.query(
    `
      INSERT INTO trips (
        origin_name,
        origin_lat,
        origin_lng,
        destination_name,
        destination_lat,
        destination_lng,
        route_kind,
        route_labels,
        route_path,
        distance_meters,
        duration_seconds,
        estimated_carbon_kg,
        fuel_consumption_liters,
        started_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
      RETURNING *
    `,
    [
      originName,
      origin.latitude,
      origin.longitude,
      destinationName,
      destination.latitude,
      destination.longitude,
      routeKind,
      routeLabels,
      JSON.stringify(routePath),
      distanceMeters,
      durationSeconds,
      estimatedCarbonKg,
      fuelConsumptionLiters,
      startedAt.toISOString(),
    ]
  );

  response.status(201).json({
    trip: serializeTrip(rows[0]),
  });
});

app.patch('/api/trips/:tripId/complete', async (request, response) => {
  const tripId = Number(request.params.tripId);
  const endedAt = new Date(request.body?.endedAt || new Date().toISOString());
  const actualDurationSeconds = Number(request.body?.actualDurationSeconds);

  if (!Number.isInteger(tripId)) {
    throw new HttpError(400, 'tripId must be a valid integer.');
  }

  if (Number.isNaN(endedAt.getTime())) {
    throw new HttpError(400, 'endedAt must be a valid ISO timestamp.');
  }

  if (!isFiniteNumber(actualDurationSeconds)) {
    throw new HttpError(400, 'actualDurationSeconds must be a number.');
  }

  const { rows } = await pool.query(
    `
      UPDATE trips
      SET
        status = 'completed',
        actual_duration_seconds = $2,
        ended_at = $3,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [tripId, Math.round(actualDurationSeconds), endedAt.toISOString()]
  );

  if (rows.length === 0) {
    throw new HttpError(404, 'Trip not found.');
  }

  response.json({
    trip: serializeTrip(rows[0]),
  });
});

app.use((error, _request, response, _next) => {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Unexpected server error.';

  if (status >= 500) {
    console.error(error);
  }

  response.status(status).json({ error: message });
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start the server.', error);
    process.exit(1);
  }
}

startServer();
