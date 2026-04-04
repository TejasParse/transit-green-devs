const CREATE_TRIPS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS trips (
    id BIGSERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'in_progress',
    origin_name TEXT NOT NULL,
    origin_lat DOUBLE PRECISION NOT NULL,
    origin_lng DOUBLE PRECISION NOT NULL,
    destination_name TEXT NOT NULL,
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,
    route_kind TEXT NOT NULL,
    route_labels TEXT[] NOT NULL DEFAULT '{}',
    route_path JSONB NOT NULL,
    distance_meters DOUBLE PRECISION NOT NULL,
    duration_seconds INTEGER NOT NULL,
    actual_duration_seconds INTEGER,
    estimated_carbon_kg DOUBLE PRECISION NOT NULL,
    fuel_consumption_liters DOUBLE PRECISION,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

async function ensureSchema(pool) {
  await pool.query(CREATE_TRIPS_TABLE_SQL);
}

async function resetSchema(pool) {
  await pool.query('DROP TABLE IF EXISTS trips CASCADE');
  await ensureSchema(pool);
}

module.exports = {
  ensureSchema,
  resetSchema,
};
