// Wishlist and Acquisition service on AWS Lambda (Ahmed).
// API Gateway sends only the /api/collections/{id}/wishlist routes to this function.
const serverless = require('serverless-http');
const createApp = require('../createApp');
const wishlistRoutes = require('../routes/wishlistRoutes');

const app = createApp((app) => {
  app.use('/api/collections/:collectionId/wishlist', wishlistRoutes);
});

module.exports.handler = serverless(app);
