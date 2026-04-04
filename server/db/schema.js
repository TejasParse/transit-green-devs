const { pool } = require('./pool');

async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS cars;
    DROP TABLE IF EXISTS trips;
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
    CREATE TABLE IF NOT EXISTS trips (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      route_type TEXT NOT NULL,
      route_title TEXT NOT NULL,
      origin_label TEXT NOT NULL,
      destination_label TEXT NOT NULL,
      distance_meters INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL,
      co2_kg NUMERIC(10, 3) NOT NULL,
      co2_saved_kg NUMERIC(10, 3) NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL,
      path_points JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
}

module.exports = {
  ensureSchema,
  resetSchema,
};
