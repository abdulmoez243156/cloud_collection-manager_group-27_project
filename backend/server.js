require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('./db/db');
const authRoutes = require('./routes/authRoutes');
const collectionRoutes = require('./routes/collectionRoutes');
const valuationRoutes = require('./routes/valuationRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Collection Manager API',
    status: 'running'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      message: error.message
    });
  }
});

// Register API Routes
app.use('/api/auth', authRoutes);
app.use('/api/collections/:collectionId/wishlist', wishlistRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api', valuationRoutes);

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

  console.error('Request failed', { method: req.method, code: error.code });
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }
  });
});

// Start on direct execution in every environment and allow imports for tests.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;