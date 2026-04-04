const dotenv = require('dotenv');
const { Pool } = require('pg');

const { resetSchema } = require('./schema');

dotenv.config();

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/innovationhacks';
const shouldSeedSampleData = !process.argv.includes('--empty');

const SAMPLE_TRIPS = [
  {
    status: 'completed',
    originName: 'Tempe Town Lake',
    origin: { latitude: 33.4319, longitude: -111.9395 },
    destinationName: 'Phoenix Convention Center',
    destination: { latitude: 33.4518, longitude: -112.0712 },
    routeKind: 'eco',
    routeLabels: ['FUEL_EFFICIENT'],
    routePath: [
      { latitude: 33.4319, longitude: -111.9395 },
      { latitude: 33.4378, longitude: -111.9667 },
      { latitude: 33.4448, longitude: -112.0121 },
      { latitude: 33.4518, longitude: -112.0712 },
    ],
    distanceMeters: 12100,
    durationSeconds: 1080,
    actualDurationSeconds: 990,
    estimatedCarbonKg: 2.26,
    fuelConsumptionLiters: 0.98,
    startedAt: '2026-04-04T16:15:00.000Z',
    endedAt: '2026-04-04T16:31:30.000Z',
  },
  {
    status: 'completed',
    originName: 'Scottsdale Quarter',
    origin: { latitude: 33.5034, longitude: -111.9292 },
    destinationName: 'Arizona State University',
    destination: { latitude: 33.4213, longitude: -111.9331 },
    routeKind: 'best-available',
    routeLabels: ['DEFAULT_ROUTE'],
    routePath: [
      { latitude: 33.5034, longitude: -111.9292 },
      { latitude: 33.4794, longitude: -111.9264 },
      { latitude: 33.4502, longitude: -111.9298 },
      { latitude: 33.4213, longitude: -111.9331 },
    ],
    distanceMeters: 9800,
    durationSeconds: 1260,
    actualDurationSeconds: 1135,
    estimatedCarbonKg: 2.45,
    fuelConsumptionLiters: null,
    startedAt: '2026-04-04T18:00:00.000Z',
    endedAt: '2026-04-04T18:18:55.000Z',
  },
];

async function insertTrip(pool, trip) {
  await pool.query(
    `
      INSERT INTO trips (
        status,
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
        actual_duration_seconds,
        estimated_carbon_kg,
        fuel_consumption_liters,
        started_at,
        ended_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17
      )
    `,
    [
      trip.status,
      trip.originName,
      trip.origin.latitude,
      trip.origin.longitude,
      trip.destinationName,
      trip.destination.latitude,
      trip.destination.longitude,
      trip.routeKind,
      trip.routeLabels,
      JSON.stringify(trip.routePath),
      trip.distanceMeters,
      trip.durationSeconds,
      trip.actualDurationSeconds,
      trip.estimatedCarbonKg,
      trip.fuelConsumptionLiters,
      trip.startedAt,
      trip.endedAt,
    ]
  );
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    await resetSchema(pool);

    if (shouldSeedSampleData) {
      for (const trip of SAMPLE_TRIPS) {
        await insertTrip(pool, trip);
      }
    }

    console.log(
      shouldSeedSampleData
        ? `Database reset complete. Inserted ${SAMPLE_TRIPS.length} sample trips.`
        : 'Database reset complete. No sample rows inserted.'
    );
  } catch (error) {
    console.error('Failed to reset and seed the database.', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
