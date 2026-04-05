const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

const PORT = Number(process.env.PORT || 3001);
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/innovationhacks';
const DATABASE_SSL = process.env.DATABASE_SSL === 'true';
const DATABASE_SSL_REJECT_UNAUTHORIZED =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
const DATABASE_SSL_CA_PATH = process.env.DATABASE_SSL_CA_PATH || '';

module.exports = {
  DATABASE_URL,
  DATABASE_SSL,
  DATABASE_SSL_CA_PATH,
  DATABASE_SSL_REJECT_UNAUTHORIZED,
  PORT,
};
