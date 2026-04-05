const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const {
  DATABASE_URL,
  DATABASE_SSL,
  DATABASE_SSL_CA_PATH,
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
    const resolvedCaPath = path.resolve(__dirname, '..', DATABASE_SSL_CA_PATH);
    poolConfig.ssl.ca = fs.readFileSync(resolvedCaPath, 'utf8');
  }
}

const pool = new Pool(poolConfig);

module.exports = {
  pool,
};
