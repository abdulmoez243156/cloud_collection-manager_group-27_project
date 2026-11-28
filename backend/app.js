// The full Collection Manager API: all three services in one Express app.
// server.js runs it on a PC (npm run dev) and Vercel runs it as one function.
// On Floci each service runs as its own Lambda function instead (see lambdas/).
const express = require('express');
const setupApp = require('./setupApp');
const authRoutes = require('./routes/authRoutes');
const collectionRoutes = require('./routes/collectionRoutes');
const valuationRoutes = require('./routes/valuationRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const itemRoutes = require('./routes/itemRoutes');

const app = express();

setupApp(app, [
  ['/api/auth', authRoutes],
  ['/api/collections/:collectionId/wishlist', wishlistRoutes],
  ['/api/collections', collectionRoutes],
  ['/api/items', itemRoutes],
  ['/api', valuationRoutes]
]);

module.exports = app;
