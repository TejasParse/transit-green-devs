const { Pool } = require('pg');

const { DATABASE_URL } = require('../config/env');

const pool = new Pool({
  connectionString: DATABASE_URL,
});

module.exports = {
  pool,
};
