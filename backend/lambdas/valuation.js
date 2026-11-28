// Valuation and Reports service on AWS Lambda (Abdelrahman).
// Also serves the shared account and collection routes, which are part of the
// same backend work: register, login, collections and members.
const express = require('express');
const serverless = require('serverless-http');
const setupApp = require('../setupApp');
const authRoutes = require('../routes/authRoutes');
const collectionRoutes = require('../routes/collectionRoutes');
const valuationRoutes = require('../routes/valuationRoutes');

const app = express();

setupApp(app, [
  ['/api/auth', authRoutes],
  ['/api/collections', collectionRoutes],
  ['/api', valuationRoutes]
]);

module.exports.handler = serverless(app);
