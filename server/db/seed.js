const { pool } = require('./pool');
const { ensureSchema, resetSchema } = require('./schema');
const { createTripRecord } = require('./trip-queries');

const now = Date.now();

const demoTrips = [
  {
    userId: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'walk',
    routeTitle: 'Walk route',
    originLabel: 'Tempe Campus Library',
    destinationLabel: 'Mill Avenue District',
    distanceMeters: 1800,
    durationSeconds: 1320,
    co2Kg: 0,
    co2SavedKg: 0.241,
    startedAt: new Date(now - 1000 * 60 * 180).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 158).toISOString(),
    pathPoints: [
      { latitude: 33.4206, longitude: -111.9344 },
      { latitude: 33.4222, longitude: -111.9314 },
      { latitude: 33.4249, longitude: -111.9281 },
    ],
    metadata: {
      badges: ['0 kg CO2', 'Lowest carbon'],
      summary: 'Seeded walking trip for local development.',
    },
  },
  {
    userId: 'bike-commuter',
    displayName: 'Bike Commuter',
    routeType: 'bike',
    routeTitle: 'Bike route',
    originLabel: 'Apache Boulevard',
    destinationLabel: 'Downtown Tempe',
    distanceMeters: 3200,
    durationSeconds: 1080,
    co2Kg: 0,
    co2SavedKg: 0.414,
    startedAt: new Date(now - 1000 * 60 * 130).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 112).toISOString(),
    pathPoints: [
      { latitude: 33.4148, longitude: -111.9091 },
      { latitude: 33.4187, longitude: -111.9215 },
      { latitude: 33.4252, longitude: -111.9392 },
    ],
    metadata: {
      badges: ['Near-zero CO2', 'Active travel'],
      summary: 'Seeded cycling trip for local development.',
    },
  },
  {
    userId: 'transit-fan',
    displayName: 'Transit Fan',
    routeType: 'transit',
    routeTitle: 'Public transit',
    originLabel: 'Mesa Arts Center',
    destinationLabel: 'ASU Tempe Campus',
    distanceMeters: 7600,
    durationSeconds: 2100,
    co2Kg: 0.38,
    co2SavedKg: 0.679,
    startedAt: new Date(now - 1000 * 60 * 90).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 55).toISOString(),
    pathPoints: [
      { latitude: 33.4155, longitude: -111.8315 },
      { latitude: 33.4157, longitude: -111.8995 },
      { latitude: 33.4234, longitude: -111.94 },
    ],
    metadata: {
      badges: ['Shared ride', 'Low carbon'],
      summary: 'Seeded public transit trip for local development.',
    },
  },
  {
    userId: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'drive',
    routeTitle: 'Fuel-efficient drive',
    originLabel: 'Phoenix Sky Harbor',
    destinationLabel: 'ASU Tempe Campus',
    distanceMeters: 12200,
    durationSeconds: 1260,
    co2Kg: 1.021,
    co2SavedKg: 0.148,
    startedAt: new Date(now - 1000 * 60 * 45).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 24).toISOString(),
    pathPoints: [
      { latitude: 33.4351, longitude: -112.0078 },
      { latitude: 33.4318, longitude: -111.9745 },
      { latitude: 33.4234, longitude: -111.94 },
    ],
    metadata: {
      badges: ['Fuel-efficient', 'Car navigation'],
      summary: 'Seeded driving trip for local development.',
    },
  },
];

async function run() {
  const keepEmpty = process.argv.includes('--empty');

  console.log('Resetting Transit Green database...');
  await resetSchema();
  await ensureSchema();

  if (keepEmpty) {
    console.log('Created a fresh schema with no seed records.');
    return;
  }

  for (const trip of demoTrips) {
    await createTripRecord(trip);
  }

  console.log(`Created a fresh schema and inserted ${demoTrips.length} seed trips.`);
}

run()
  .catch((error) => {
    console.error('Failed to reset and seed the database.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
