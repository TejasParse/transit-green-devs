const { pool } = require('./pool');

async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS forest_trees;
    DROP TABLE IF EXISTS carpool_requests;
    DROP TABLE IF EXISTS trip_users;
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
      licence_no TEXT UNIQUE
    )
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
      carpool_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      max_detour_type TEXT CHECK (max_detour_type IN ('time', 'distance')),
      max_detour_value NUMERIC(10, 2),
      price_per_seat_mile NUMERIC(10, 2),
      simulation_speed_multiplier NUMERIC(6, 2) NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ended' CHECK (status IN ('scheduled', 'active', 'cancelled', 'ended')),
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL,
      path_points JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD COLUMN IF NOT EXISTS carpool_enabled BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD COLUMN IF NOT EXISTS max_detour_type TEXT
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD COLUMN IF NOT EXISTS max_detour_value NUMERIC(10, 2)
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD COLUMN IF NOT EXISTS price_per_seat_mile NUMERIC(10, 2)
  `);

  await pool.query(`
    ALTER TABLE trips
    ADD COLUMN IF NOT EXISTS simulation_speed_multiplier NUMERIC(6, 2) NOT NULL DEFAULT 1
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_users (
      id SERIAL PRIMARY KEY,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      rider_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (trip_id, rider_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carpool_requests (
      id SERIAL PRIMARY KEY,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      rider_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'accepted', 'declined', 'cancelled')
      ),
      pickup_label TEXT NOT NULL,
      dropoff_label TEXT NOT NULL,
      pickup_point JSONB NOT NULL,
      dropoff_point JSONB NOT NULL,
      pickup_distance_meters INTEGER NOT NULL DEFAULT 0 CHECK (pickup_distance_meters >= 0),
      dropoff_distance_meters INTEGER NOT NULL DEFAULT 0 CHECK (dropoff_distance_meters >= 0),
      destination_gap_meters INTEGER NOT NULL DEFAULT 0 CHECK (destination_gap_meters >= 0),
      estimated_detour_minutes NUMERIC(8, 2) NOT NULL DEFAULT 0,
      projected_pickup_index INTEGER NOT NULL DEFAULT 0 CHECK (projected_pickup_index >= 0),
      projected_dropoff_index INTEGER NOT NULL DEFAULT 0 CHECK (projected_dropoff_index >= 0),
      quoted_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (trip_id, rider_id)
    )
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
    CREATE INDEX IF NOT EXISTS cars_make_model_idx
    ON cars (make, model)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trip_users_trip_idx
    ON trip_users (trip_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trips_carpool_status_idx
    ON trips (carpool_enabled, status, started_at DESC)
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
    CREATE INDEX IF NOT EXISTS carpool_requests_trip_status_idx
    ON carpool_requests (trip_id, status, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS carpool_requests_rider_idx
    ON carpool_requests (rider_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS forest_trees_user_idx
    ON forest_trees (user_id, created_at DESC)
  `);
}

module.exports = {
  ensureSchema,
  resetSchema,
};
