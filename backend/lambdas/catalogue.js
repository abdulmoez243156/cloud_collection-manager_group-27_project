// Collection Catalogue service on AWS Lambda (Abdulmoez).
// API Gateway sends only the /api/items routes to this function.
// serverless-http turns the Lambda event into an Express request and back (Lab 7).
const express = require('express');
const serverless = require('serverless-http');
const setupApp = require('../setupApp');
const itemRoutes = require('../routes/itemRoutes');

const app = express();

setupApp(app, [
  ['/api/items', itemRoutes]
]);

module.exports.handler = serverless(app);
