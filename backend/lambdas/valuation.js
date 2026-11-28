// Valuation and Reports service on AWS Lambda (Abdelrahman).
// Also serves the shared account and collection routes, which are part of the
// same backend work: register, login, collections and members.
const serverless = require('serverless-http');
const createApp = require('../createApp');
const authRoutes = require('../routes/authRoutes');
const collectionRoutes = require('../routes/collectionRoutes');
const valuationRoutes = require('../routes/valuationRoutes');

const app = createApp((app) => {
  app.use('/api/auth', authRoutes);
  app.use('/api/collections', collectionRoutes);
  app.use('/api', valuationRoutes);
});

module.exports.handler = serverless(app);
