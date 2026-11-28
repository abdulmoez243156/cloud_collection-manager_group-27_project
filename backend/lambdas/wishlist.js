// Wishlist and Acquisition service on AWS Lambda (Ahmed).
// API Gateway sends only the /api/collections/{id}/wishlist routes to this function.
const express = require('express');
const serverless = require('serverless-http');
const setupApp = require('../setupApp');
const wishlistRoutes = require('../routes/wishlistRoutes');

const app = express();

setupApp(app, [
  ['/api/collections/:collectionId/wishlist', wishlistRoutes]
]);

module.exports.handler = serverless(app);
