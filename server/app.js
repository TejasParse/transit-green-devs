const express = require('express');

const carpoolRoutes = require('./routes/carpool-routes');
const dashboardRoutes = require('./routes/dashboard-routes');
const ecoDestinationRoutes = require('./routes/eco-destination-routes');
const healthRoutes = require('./routes/health-routes');
const tripRoutes = require('./routes/trip-routes');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(healthRoutes);
app.use(ecoDestinationRoutes);
app.use(dashboardRoutes);
app.use(carpoolRoutes);
app.use(tripRoutes);
app.use(errorHandler);

module.exports = { app };
