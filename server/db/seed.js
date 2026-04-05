const fs = require('node:fs');
const path = require('node:path');

const { pool } = require('./pool');
const { ensureSchema, resetSchema } = require('./schema');
const { createTripRecord } = require('./trip-queries');

const now = Date.now();
const CARS_CSV_PATH = path.join(__dirname, '..', '..', 'co2.csv');

const demoProfiles = [
  {
    key: 'campus-rider',
    userName: 'Campus Rider',
    carId: 1,
    totalPoints: 0,
    email: 'campus.rider@example.com',
    age: 22,
    gender: 'female',
    licenceNo: 'A94276153',
  },
  {
    key: 'bike-commuter',
    userName: 'Bike Commuter',
    carId: null,
    totalPoints: 0,
    email: 'bike.commuter@example.com',
    age: 28,
    gender: 'male',
    licenceNo: null,
  },
  {
    key: 'transit-fan',
    userName: 'Transit Fan',
    carId: null,
    totalPoints: 0,
    email: 'transit.fan@example.com',
    age: 25,
    gender: 'female',
    licenceNo: null,
  },
  {
    key: 'community-driver',
    userName: 'Community Driver',
    carId: 4,
    totalPoints: 0,
    email: 'community.driver@example.com',
    age: 31,
    gender: 'non-binary',
    licenceNo: '615208473',
  },
];

const demoTrips = [
  {
    key: 'walk-ended',
    profileKey: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'walk',
    routeTitle: 'Walk route',
    originLabel: 'Tempe Campus Library',
    destinationLabel: 'Mill Avenue District',
    distanceMeters: 1800,
    durationSeconds: 1320,
    co2Kg: 0,
    co2SavedKg: 0.241,
    availableSeats: 0,
    status: 'ended',
    startedAt: new Date(now - 1000 * 60 * 240).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 218).toISOString(),
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
    key: 'bike-ended',
    profileKey: 'bike-commuter',
    displayName: 'Bike Commuter',
    routeType: 'bike',
    routeTitle: 'Bike route',
    originLabel: 'Apache Boulevard',
    destinationLabel: 'Downtown Tempe',
    distanceMeters: 3200,
    durationSeconds: 1080,
    co2Kg: 0,
    co2SavedKg: 0.414,
    availableSeats: 0,
    status: 'ended',
    startedAt: new Date(now - 1000 * 60 * 205).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 187).toISOString(),
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
    key: 'drive-ended',
    profileKey: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'drive',
    routeTitle: 'Fuel-efficient drive',
    originLabel: 'Phoenix Sky Harbor',
    destinationLabel: 'ASU Tempe Campus',
    distanceMeters: 12200,
    durationSeconds: 1260,
    co2Kg: 1.021,
    co2SavedKg: 0.148,
    availableSeats: 1,
    carpoolEnabled: true,
    maxDetourType: 'distance',
    maxDetourValue: 1.5,
    pricePerSeatMile: 1.25,
    simulationSpeedMultiplier: 1,
    status: 'ended',
    startedAt: new Date(now - 1000 * 60 * 150).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 129).toISOString(),
    pathPoints: [
      { latitude: 33.4351, longitude: -112.0078 },
      { latitude: 33.4318, longitude: -111.9745 },
      { latitude: 33.4234, longitude: -111.94 },
    ],
    metadata: {
      badges: ['Fuel-efficient', 'Car navigation'],
      summary: 'Seeded completed driving trip for local development.',
    },
  },
  {
    key: 'transit-active',
    profileKey: 'transit-fan',
    displayName: 'Transit Fan',
    routeType: 'transit',
    routeTitle: 'Public transit',
    originLabel: 'Mesa Arts Center',
    destinationLabel: 'ASU Tempe Campus',
    distanceMeters: 7600,
    durationSeconds: 2100,
    co2Kg: 0.38,
    co2SavedKg: 0.679,
    availableSeats: 0,
    status: 'active',
    startedAt: new Date(now - 1000 * 60 * 35).toISOString(),
    completedAt: new Date(now + 1000 * 60 * 5).toISOString(),
    pathPoints: [
      { latitude: 33.4155, longitude: -111.8315 },
      { latitude: 33.4157, longitude: -111.8995 },
      { latitude: 33.4234, longitude: -111.94 },
    ],
    metadata: {
      badges: ['Shared ride', 'Low carbon'],
      summary: 'Seeded active transit trip for local development.',
    },
  },
  {
    key: 'drive-scheduled',
    profileKey: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'drive',
    routeTitle: 'Fuel-efficient drive',
    originLabel: 'ASU Tempe Campus',
    destinationLabel: 'Scottsdale Waterfront',
    distanceMeters: 15100,
    durationSeconds: 1440,
    co2Kg: 1.184,
    co2SavedKg: 0.163,
    availableSeats: 2,
    carpoolEnabled: true,
    maxDetourType: 'time',
    maxDetourValue: 10,
    pricePerSeatMile: 1.1,
    simulationSpeedMultiplier: 1.5,
    status: 'scheduled',
    startedAt: new Date(now + 1000 * 60 * 60).toISOString(),
    completedAt: new Date(now + 1000 * 60 * 84).toISOString(),
    pathPoints: [
      { latitude: 33.4234, longitude: -111.94 },
      { latitude: 33.4573, longitude: -111.9261 },
      { latitude: 33.5018, longitude: -111.9251 },
    ],
    metadata: {
      badges: ['Fuel-efficient', 'Car navigation'],
      summary: 'Seeded scheduled driving trip for local development.',
    },
  },
  {
    key: 'drive-cancelled',
    profileKey: 'community-driver',
    displayName: 'Community Driver',
    routeType: 'drive',
    routeTitle: 'Fuel-efficient drive',
    originLabel: 'Downtown Phoenix',
    destinationLabel: 'Tempe Marketplace',
    distanceMeters: 13800,
    durationSeconds: 1320,
    co2Kg: 1.097,
    co2SavedKg: 0.152,
    availableSeats: 3,
    status: 'cancelled',
    startedAt: new Date(now - 1000 * 60 * 90).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 68).toISOString(),
    pathPoints: [
      { latitude: 33.4484, longitude: -112.074 },
      { latitude: 33.4382, longitude: -112.0126 },
      { latitude: 33.4301, longitude: -111.9012 },
    ],
    metadata: {
      badges: ['Fuel-efficient', 'Car navigation'],
      summary: 'Seeded cancelled driving trip for local development.',
    },
  },
];

const demoTripUsers = [
  { tripKey: 'walk-ended', driverKey: 'campus-rider', riderKey: 'campus-rider' },
  { tripKey: 'bike-ended', driverKey: 'bike-commuter', riderKey: 'bike-commuter' },
  { tripKey: 'drive-ended', driverKey: 'campus-rider', riderKey: 'campus-rider' },
  { tripKey: 'drive-ended', driverKey: 'campus-rider', riderKey: 'bike-commuter' },
  { tripKey: 'transit-active', driverKey: 'transit-fan', riderKey: 'transit-fan' },
  { tripKey: 'drive-scheduled', driverKey: 'campus-rider', riderKey: 'campus-rider' },
  { tripKey: 'drive-scheduled', driverKey: 'campus-rider', riderKey: 'transit-fan' },
  { tripKey: 'drive-cancelled', driverKey: 'community-driver', riderKey: 'community-driver' },
  { tripKey: 'drive-cancelled', driverKey: 'community-driver', riderKey: 'bike-commuter' },
];

const demoCarpoolRequests = [
  {
    tripKey: 'drive-ended',
    hostKey: 'campus-rider',
    riderKey: 'bike-commuter',
    status: 'accepted',
    pickupLabel: 'Sky Harbor Terminal 4',
    dropoffLabel: 'ASU Tempe North Entrance',
    pickupPoint: { latitude: 33.4324, longitude: -111.9794 },
    dropoffPoint: { latitude: 33.4239, longitude: -111.9415 },
    pickupDistanceMeters: 540,
    dropoffDistanceMeters: 180,
    destinationGapMeters: 160,
    estimatedDetourMinutes: 4.2,
    projectedPickupIndex: 1,
    projectedDropoffIndex: 2,
    quotedPrice: 6.45,
  },
  {
    tripKey: 'drive-scheduled',
    hostKey: 'campus-rider',
    riderKey: 'transit-fan',
    status: 'accepted',
    pickupLabel: 'Mill Avenue Bridge',
    dropoffLabel: 'Old Town Scottsdale',
    pickupPoint: { latitude: 33.4326, longitude: -111.9398 },
    dropoffPoint: { latitude: 33.4988, longitude: -111.9276 },
    pickupDistanceMeters: 410,
    dropoffDistanceMeters: 270,
    destinationGapMeters: 340,
    estimatedDetourMinutes: 6.1,
    projectedPickupIndex: 1,
    projectedDropoffIndex: 2,
    quotedPrice: 7.9,
  },
  {
    tripKey: 'drive-scheduled',
    hostKey: 'campus-rider',
    riderKey: 'community-driver',
    status: 'pending',
    pickupLabel: 'Tempe Marketplace',
    dropoffLabel: 'Scottsdale Fashion Square',
    pickupPoint: { latitude: 33.4301, longitude: -111.9012 },
    dropoffPoint: { latitude: 33.5015, longitude: -111.9271 },
    pickupDistanceMeters: 760,
    dropoffDistanceMeters: 350,
    destinationGapMeters: 190,
    estimatedDetourMinutes: 8.4,
    projectedPickupIndex: 1,
    projectedDropoffIndex: 2,
    quotedPrice: 8.72,
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

async function seedProfiles() {
  const profileIdMap = new Map();

  for (const profile of demoProfiles) {
    const result = await pool.query(
      `
        INSERT INTO profiles (
          user_name,
          car_id,
          total_points,
          email,
          age,
          gender,
          licence_no
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        profile.userName,
        profile.carId,
        profile.totalPoints,
        profile.email,
        profile.age,
        profile.gender,
        profile.licenceNo,
      ]
    );

    profileIdMap.set(profile.key, result.rows[0].id);
  }

  return profileIdMap;
}

async function seedTrips(profileIdMap) {
  const tripIdMap = new Map();

  for (const trip of demoTrips) {
    const savedTrip = await createTripRecord({
      userId: profileIdMap.get(trip.profileKey),
      displayName: trip.displayName,
      routeType: trip.routeType,
      routeTitle: trip.routeTitle,
      originLabel: trip.originLabel,
      destinationLabel: trip.destinationLabel,
      distanceMeters: trip.distanceMeters,
      durationSeconds: trip.durationSeconds,
      co2Kg: trip.co2Kg,
      co2SavedKg: trip.co2SavedKg,
      availableSeats: trip.availableSeats,
      carpoolEnabled: trip.carpoolEnabled,
      maxDetourType: trip.maxDetourType,
      maxDetourValue: trip.maxDetourValue,
      pricePerSeatMile: trip.pricePerSeatMile,
      simulationSpeedMultiplier: trip.simulationSpeedMultiplier,
      status: trip.status,
      startedAt: trip.startedAt,
      completedAt: trip.completedAt,
      pathPoints: trip.pathPoints,
      metadata: trip.metadata,
    });

    tripIdMap.set(trip.key, savedTrip.id);
  }

  return tripIdMap;
}

async function seedTripUsers(profileIdMap, tripIdMap) {
  for (const tripUser of demoTripUsers) {
    await pool.query(
      `
        INSERT INTO trip_users (trip_id, driver_id, rider_id)
        VALUES ($1, $2, $3)
      `,
      [
        tripIdMap.get(tripUser.tripKey),
        profileIdMap.get(tripUser.driverKey),
        profileIdMap.get(tripUser.riderKey),
      ]
    );
  }

  return demoTripUsers.length;
}

async function seedCarpoolRequests(profileIdMap, tripIdMap) {
  for (const request of demoCarpoolRequests) {
    await pool.query(
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
          quoted_price,
          responded_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
          $9, $10, $11, $12, $13, $14, $15,
          CASE WHEN $4 = 'pending' THEN NULL ELSE NOW() END
        )
      `,
      [
        tripIdMap.get(request.tripKey),
        profileIdMap.get(request.hostKey),
        profileIdMap.get(request.riderKey),
        request.status,
        request.pickupLabel,
        request.dropoffLabel,
        JSON.stringify(request.pickupPoint),
        JSON.stringify(request.dropoffPoint),
        request.pickupDistanceMeters,
        request.dropoffDistanceMeters,
        request.destinationGapMeters,
        request.estimatedDetourMinutes,
        request.projectedPickupIndex,
        request.projectedDropoffIndex,
        request.quotedPrice,
      ]
    );
  }

  return demoCarpoolRequests.length;
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
  const profileIdMap = await seedProfiles();
  const tripIdMap = await seedTrips(profileIdMap);
  const tripUserCount = await seedTripUsers(profileIdMap, tripIdMap);
  const carpoolRequestCount = await seedCarpoolRequests(profileIdMap, tripIdMap);

  console.log(
    `Created a fresh schema and inserted ${carCount} cars, ${profileIdMap.size} profiles, ${tripIdMap.size} trips, ${tripUserCount} trip-user records, and ${carpoolRequestCount} carpool requests.`
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
