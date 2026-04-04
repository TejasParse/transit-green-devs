const { app } = require('./app');
const { PORT } = require('./config/env');
const { ensureSchema } = require('./db/schema');

async function startServer() {
  await ensureSchema();
  app.listen(PORT, () => {
    console.log(`Transit Green server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start the Transit Green server.', error);
  process.exit(1);
});
