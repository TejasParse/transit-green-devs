const express = require('express');

const healthRoutes = require('./routes/health-routes');
const tripRoutes = require('./routes/trip-routes');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(healthRoutes);
app.use(tripRoutes);
app.use(errorHandler);

module.exports = { app };
