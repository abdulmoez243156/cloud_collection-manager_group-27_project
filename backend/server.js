require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('./db/db');
const authRoutes = require('./routes/authRoutes');
const collectionRoutes = require('./routes/collectionRoutes');

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
app.use('/api/collections', collectionRoutes);

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;