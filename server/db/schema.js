const { pool } = require('./pool');

async function ensureSchema() {
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
}

module.exports = {
  ensureSchema,
};
