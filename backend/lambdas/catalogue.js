// Collection Catalogue service on AWS Lambda (Abdulmoez).
// API Gateway sends only the /api/items routes to this function.
// serverless-http turns the Lambda event into an Express request and back (Lab 7).
const serverless = require('serverless-http');
const createApp = require('../createApp');
const itemRoutes = require('../routes/itemRoutes');

const app = createApp((app) => {
  app.use('/api/items', itemRoutes);
});

module.exports.handler = serverless(app);
