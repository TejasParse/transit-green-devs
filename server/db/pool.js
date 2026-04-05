const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const AWS = require('aws-sdk');

const {
  AWS_REGION,
  DATABASE_HOST,
  DATABASE_NAME,
  DATABASE_PORT,
  DATABASE_URL,
  DATABASE_SSL,
  DATABASE_SSL_CA_PATH,
  DATABASE_SSL_REJECT_UNAUTHORIZED,
  DATABASE_USE_IAM_AUTH,
  DATABASE_USER,
} = require('../config/env');

AWS.config.update({ region: AWS_REGION });

function getSslConfig() {
  if (!DATABASE_SSL) {
    return undefined;
  }

  const sslConfig = {
    rejectUnauthorized: DATABASE_SSL_REJECT_UNAUTHORIZED,
  };

  if (DATABASE_SSL_CA_PATH) {
    const resolvedCaPath = path.resolve(__dirname, '..', DATABASE_SSL_CA_PATH);
    sslConfig.ca = fs.readFileSync(resolvedCaPath, 'utf8');
  }

  return sslConfig;
}

const poolConfig = DATABASE_USE_IAM_AUTH
  ? {
      host: DATABASE_HOST,
      port: DATABASE_PORT,
      database: DATABASE_NAME,
      user: DATABASE_USER,
      password: async () => {
        const signer = new AWS.RDS.Signer({
          region: AWS_REGION,
          hostname: DATABASE_HOST,
          port: DATABASE_PORT,
          username: DATABASE_USER,
        });

        return signer.getAuthToken({});
      },
      ssl: getSslConfig(),
    }
  : {
      connectionString: DATABASE_URL,
      ssl: getSslConfig(),
    };

const pool = new Pool(poolConfig);

module.exports = {
  pool,
};
