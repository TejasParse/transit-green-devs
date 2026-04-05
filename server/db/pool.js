const { Pool } = require('pg');

const {
  DATABASE_URL,
  DATABASE_SSL,
  DATABASE_SSL_REJECT_UNAUTHORIZED,
} = require('../config/env');

const poolConfig = {
  connectionString: DATABASE_URL,
};

if (DATABASE_SSL) {
  poolConfig.ssl = {
    rejectUnauthorized: DATABASE_SSL_REJECT_UNAUTHORIZED,
  };
}

const pool = new Pool(poolConfig);

module.exports = {
  pool,
};
