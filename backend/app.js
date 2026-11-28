// The full Collection Manager API: all three services in one Express app.
// server.js runs it on a PC (npm run dev) and Vercel runs it as one function.
// On Floci each service runs as its own Lambda function instead (see lambdas/).
const createApp = require('./createApp');
const authRoutes = require('./routes/authRoutes');
const collectionRoutes = require('./routes/collectionRoutes');
const valuationRoutes = require('./routes/valuationRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const itemRoutes = require('./routes/itemRoutes');

const app = createApp((app) => {
  app.use('/api/auth', authRoutes);
  app.use('/api/collections/:collectionId/wishlist', wishlistRoutes);
  app.use('/api/collections', collectionRoutes);
  app.use('/api/items', itemRoutes);
  app.use('/api', valuationRoutes);
});

module.exports = app;
