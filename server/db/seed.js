const fs = require('node:fs');
const path = require('node:path');

const { pool } = require('./pool');
const { ensureSchema, resetSchema } = require('./schema');
const { createTripRecord } = require('./trip-queries');

const now = Date.now();
const CARS_CSV_PATH = path.join(__dirname, '..', '..', 'co2.csv');

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

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function randomCapacity() {
  return Math.floor(Math.random() * 3) + 4;
}

function toNumber(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Invalid numeric value for ${fieldName}: ${value}`);
  }

  return parsedValue;
}

async function seedCarsFromCsv() {
  const fileContents = fs.readFileSync(CARS_CSV_PATH, 'utf8').trim();
  const lines = fileContents.split(/\r?\n/);

  if (lines.length < 2) {
    throw new Error('co2.csv does not contain any car records to seed.');
  }

  const [, ...records] = lines;

  await pool.query('BEGIN');

  try {
    for (const record of records) {
      const [
        make,
        model,
        vehicleClass,
        engineSize,
        cylinders,
        transmission,
        fuelType,
        fuelConsumptionCity,
        fuelConsumptionHwy,
        fuelConsumptionComb,
        fuelConsumptionCombMpg,
        co2Emissions,
      ] = parseCsvLine(record);

      await pool.query(
        `
          INSERT INTO cars (
            make,
            model,
            vehicle_class,
            engine_size_l,
            cylinders,
            transmission,
            fuel_type,
            fuel_consumption_city_l_per_100km,
            fuel_consumption_hwy_l_per_100km,
            fuel_consumption_comb_l_per_100km,
            fuel_consumption_comb_mpg,
            co2_emissions_g_per_km,
            capacity
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13
          )
        `,
        [
          make,
          model,
          vehicleClass,
          toNumber(engineSize, 'Engine Size(L)'),
          Math.round(toNumber(cylinders, 'Cylinders')),
          transmission,
          fuelType,
          toNumber(fuelConsumptionCity, 'Fuel Consumption City (L/100 km)'),
          toNumber(fuelConsumptionHwy, 'Fuel Consumption Hwy (L/100 km)'),
          toNumber(fuelConsumptionComb, 'Fuel Consumption Comb (L/100 km)'),
          Math.round(toNumber(fuelConsumptionCombMpg, 'Fuel Consumption Comb (mpg)')),
          Math.round(toNumber(co2Emissions, 'CO2 Emissions(g/km)')),
          randomCapacity(),
        ]
      );
    }

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  return records.length;
}

async function run() {
  const keepEmpty = process.argv.includes('--empty');

  console.log('Resetting Transit Green database...');
  await resetSchema();
  await ensureSchema();

  if (keepEmpty) {
    console.log('Created a fresh schema with no seed records.');
    return;
  }

  const carCount = await seedCarsFromCsv();

  for (const trip of demoTrips) {
    await createTripRecord(trip);
  }

  console.log(
    `Created a fresh schema and inserted ${carCount} cars plus ${demoTrips.length} seed trips.`
  );
}

run()
  .catch((error) => {
    console.error('Failed to reset and seed the database.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
