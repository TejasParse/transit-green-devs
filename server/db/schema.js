const { pool } = require('./pool');

const TRIP_STATUSES = [
  'draft',
  'scheduled',
  'confirmed',
  'active',
  'completed',
  'cancelled',
  'expired',
  'ended',
];

const CARPOOL_REQUEST_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'cancelled_by_rider',
  'expired',
];

const PARTICIPANT_ROLES = ['driver', 'rider'];
const RECURRENCE_PATTERNS = ['none', 'daily', 'weekdays'];

async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS forest_trees;
    DROP TABLE IF EXISTS trip_users;
    DROP TABLE IF EXISTS carpool_requests;
    DROP TABLE IF EXISTS trips;
    DROP TABLE IF EXISTS profiles;
    DROP TABLE IF EXISTS cars;
  `);
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cars (
      id SERIAL PRIMARY KEY,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      vehicle_class TEXT NOT NULL,
      engine_size_l NUMERIC(6, 2) NOT NULL,
      cylinders INTEGER NOT NULL,
      transmission TEXT NOT NULL,
      fuel_type TEXT NOT NULL,
      fuel_consumption_city_l_per_100km NUMERIC(6, 2) NOT NULL,
      fuel_consumption_hwy_l_per_100km NUMERIC(6, 2) NOT NULL,
      fuel_consumption_comb_l_per_100km NUMERIC(6, 2) NOT NULL,
      fuel_consumption_comb_mpg INTEGER NOT NULL,
      co2_emissions_g_per_km INTEGER NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity BETWEEN 4 AND 6),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      user_name TEXT NOT NULL,
      car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
      total_points INTEGER NOT NULL DEFAULT 0,
      email TEXT NOT NULL UNIQUE,
      age INTEGER NOT NULL CHECK (age > 0),
      gender TEXT NOT NULL,
      licence_no TEXT UNIQUE,
      auth_provider TEXT,
      auth_subject TEXT UNIQUE,
      picture_url TEXT,
      carpool_rating_avg NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
      carpool_rating_count INTEGER NOT NULL DEFAULT 0 CHECK (carpool_rating_count >= 0),
      carpool_cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (carpool_cancellation_count >= 0),
      carpool_blocked BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await pool.query(`
    ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS auth_provider TEXT,
    ADD COLUMN IF NOT EXISTS auth_subject TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS picture_url TEXT,
    ADD COLUMN IF NOT EXISTS carpool_rating_avg NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
    ADD COLUMN IF NOT EXISTS carpool_rating_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS carpool_cancellation_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS carpool_blocked BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      route_type TEXT NOT NULL,
      route_title TEXT NOT NULL,
      origin_label TEXT NOT NULL,
      destination_label TEXT NOT NULL,
      distance_meters INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL,
      co2_kg NUMERIC(10, 3) NOT NULL,
      co2_saved_kg NUMERIC(10, 3) NOT NULL DEFAULT 0,
      available_seats INTEGER NOT NULL DEFAULT 0 CHECK (available_seats >= 0),
      seat_capacity INTEGER NOT NULL DEFAULT 0 CHECK (seat_capacity >= 0),
      pickup_flexibility_minutes INTEGER NOT NULL DEFAULT 0 CHECK (pickup_flexibility_minutes >= 0),
      matching_radius_meters INTEGER NOT NULL DEFAULT 0 CHECK (matching_radius_meters >= 0),
      max_deviation_minutes INTEGER NOT NULL DEFAULT 0 CHECK (max_deviation_minutes >= 0),
      price_per_mile_usd NUMERIC(8, 2) NOT NULL DEFAULT 0 CHECK (price_per_mile_usd >= 0),
      recurrence_pattern TEXT NOT NULL DEFAULT 'none',
      recurrence_group_key TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL,
      path_points JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD COLUMN IF NOT EXISTS seat_capacity INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pickup_flexibility_minutes INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS matching_radius_meters INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_deviation_minutes INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS price_per_mile_usd NUMERIC(8, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS recurrence_pattern TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS recurrence_group_key TEXT
  `);

  await pool.query(`
    UPDATE trips
    SET seat_capacity = GREATEST(COALESCE(seat_capacity, 0), COALESCE(available_seats, 0))
    WHERE seat_capacity IS NULL OR seat_capacity = 0
  `);

  await pool.query(`
    ALTER TABLE trips
    DROP CONSTRAINT IF EXISTS trips_status_check
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD CONSTRAINT trips_status_check
    CHECK (status IN (${TRIP_STATUSES.map((status) => `'${status}'`).join(', ')}))
  `);

  await pool.query(`
    ALTER TABLE trips
    DROP CONSTRAINT IF EXISTS trips_recurrence_pattern_check
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD CONSTRAINT trips_recurrence_pattern_check
    CHECK (recurrence_pattern IN (${RECURRENCE_PATTERNS.map((pattern) => `'${pattern}'`).join(', ')}))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carpool_requests (
      id SERIAL PRIMARY KEY,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      rider_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      rider_origin_label TEXT NOT NULL,
      rider_destination_label TEXT NOT NULL,
      pickup_point JSONB NOT NULL DEFAULT '{}'::jsonb,
      dropoff_point JSONB NOT NULL DEFAULT '{}'::jsonb,
      requested_departure_time TIMESTAMPTZ NOT NULL,
      estimated_distance_meters INTEGER NOT NULL DEFAULT 0 CHECK (estimated_distance_meters >= 0),
      estimated_added_minutes INTEGER NOT NULL DEFAULT 0 CHECK (estimated_added_minutes >= 0),
      estimated_price_usd NUMERIC(8, 2) NOT NULL DEFAULT 0 CHECK (estimated_price_usd >= 0),
      decision_note TEXT,
      expires_at TIMESTAMPTZ,
      responded_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE carpool_requests
    DROP CONSTRAINT IF EXISTS carpool_requests_status_check
  `);

  await pool.query(`
    ALTER TABLE carpool_requests
    ADD CONSTRAINT carpool_requests_status_check
    CHECK (status IN (${CARPOOL_REQUEST_STATUSES.map((status) => `'${status}'`).join(', ')}))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_users (
      id SERIAL PRIMARY KEY,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      rider_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
      participant_role TEXT NOT NULL DEFAULT 'rider',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      joined_via_request_id INTEGER REFERENCES carpool_requests(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (trip_id, rider_id)
    )
  `);

  await pool.query(`
    ALTER TABLE trip_users
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS participant_role TEXT NOT NULL DEFAULT 'rider',
    ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS joined_via_request_id INTEGER REFERENCES carpool_requests(id) ON DELETE SET NULL
  `);

  await pool.query(`
    UPDATE trip_users
    SET
      user_id = COALESCE(user_id, rider_id),
      participant_role = CASE
        WHEN COALESCE(user_id, rider_id) = driver_id THEN 'driver'
        ELSE 'rider'
      END,
      joined_at = COALESCE(joined_at, created_at, NOW())
    WHERE user_id IS NULL
       OR participant_role NOT IN (${PARTICIPANT_ROLES.map((role) => `'${role}'`).join(', ')})
       OR joined_at IS NULL
  `);

  await pool.query(`
    ALTER TABLE trip_users
    ALTER COLUMN user_id SET NOT NULL
  `);

  await pool.query(`
    ALTER TABLE trip_users
    DROP CONSTRAINT IF EXISTS trip_users_participant_role_check
  `);

  await pool.query(`
    ALTER TABLE trip_users
    ADD CONSTRAINT trip_users_participant_role_check
    CHECK (participant_role IN (${PARTICIPANT_ROLES.map((role) => `'${role}'`).join(', ')}))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS forest_trees (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      tree_type TEXT NOT NULL,
      grid_x INTEGER NOT NULL CHECK (grid_x >= 0),
      grid_y INTEGER NOT NULL CHECK (grid_y >= 0),
      points_cost INTEGER NOT NULL CHECK (points_cost >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, grid_x, grid_y)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trips_user_completed_idx
    ON trips (user_id, completed_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trips_route_status_started_idx
    ON trips (route_type, status, started_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cars_make_model_idx
    ON cars (make, model)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS carpool_requests_trip_status_idx
    ON carpool_requests (trip_id, status, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS carpool_requests_rider_idx
    ON carpool_requests (rider_id, created_at DESC)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS carpool_requests_one_open_request_idx
    ON carpool_requests (trip_id, rider_id)
    WHERE status IN ('pending', 'accepted')
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trip_users_trip_idx
    ON trip_users (trip_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trip_users_driver_idx
    ON trip_users (driver_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trip_users_rider_idx
    ON trip_users (rider_id)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trip_users_trip_user_idx
    ON trip_users (trip_id, user_id)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trip_users_one_driver_per_trip_idx
    ON trip_users (trip_id)
    WHERE participant_role = 'driver' AND left_at IS NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS forest_trees_user_idx
    ON forest_trees (user_id, created_at DESC)
  `);
}

module.exports = {
  CARPOOL_REQUEST_STATUSES,
  PARTICIPANT_ROLES,
  RECURRENCE_PATTERNS,
  TRIP_STATUSES,
  ensureSchema,
  resetSchema,
};
