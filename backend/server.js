require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const sql = require('./db/db');
const securityHeaders = require('./middleware/securityHeaders');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');
const authRoutes = require('./routes/authRoutes');
const collectionRoutes = require('./routes/collectionRoutes');
const valuationRoutes = require('./routes/valuationRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const itemRoutes = require('./routes/itemRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Do not advertise the framework in a response header.
app.disable('x-powered-by');

// Logging and monitoring: one line per request with its result and duration.
// On Vercel these lines appear under the project's Logs tab.
// Only the path is logged, never headers or bodies, so tokens and passwords
// can never end up in the logs.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

app.use(securityHeaders);

// Allowed frontend origins come from the environment (comma-separated):
// the local frontend and the deployed Vercel frontend.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));

// Parse JSON bodies, refusing anything larger than 32 KB (413).
app.use(express.json({ limit: '32kb' }));

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Collection Manager API',
    status: 'running',
    endpoints: ['/api/health', '/api/auth', '/api/collections', '/api/items']
  });
});

// Health check: proves the deployment runs and can reach the database.
// Kept before the rate limiter so monitoring can always call it.
app.get('/api/health', async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    // The detail goes to the server log only, never to the client.
    console.error('Health check: database unreachable:', error.message);
    res.status(500).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});

// Rate limits: strict for login/registration, generous for everything else.
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// Register API Routes
app.use('/api/auth', authRoutes);
app.use('/api/collections/:collectionId/wishlist', wishlistRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/items', itemRoutes);
app.use('/api', valuationRoutes);

// No route matched (Lab 4 error format).
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' }
  });
});

// Return JSON for errors forwarded by controllers and the request parser.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' }
    });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }
    });
  }

  const status = error.status;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({
      error: { code: 'REQUEST_ERROR', message: 'Could not process the request.' }
    });
  }

  // Full detail in the server log; a safe generic message for the client.
  console.error('Request failed', { method: req.method, path: req.path, code: error.code, message: error.message });
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }
  });
});

// Start on direct execution in every environment and allow imports for tests.
// Vercel imports the exported app and runs it as one serverless function.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
