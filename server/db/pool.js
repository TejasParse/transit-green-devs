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

  if (DATABASE_SSL_CA_PATH) {
    poolConfig.ssl.ca = require('fs').readFileSync('./global-bundle.pem').toString();
  }
}

const pool = new Pool(poolConfig);

module.exports = {
  pool,
};
