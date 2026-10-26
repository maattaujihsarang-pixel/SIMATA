const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const apiRoutes = require('./routes');
const errorMiddleware = require('./middleware/error.middleware');

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS configuration
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true
}));

// HTTP request logger
if (env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Request parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Assets (BUG 26 resolution: zero-auth public access for logo, favicon, CSS, JS)
const publicDir = path.resolve(__dirname, '../../public');
const uploadDir = env.STORAGE_PATH;

app.use('/assets', express.static(path.join(publicDir, 'assets')));
app.use('/css', express.static(path.join(publicDir, 'css')));
app.use('/js', express.static(path.join(publicDir, 'js')));
app.use('/favicon.ico', express.static(path.join(publicDir, 'favicon.ico')));
app.use('/uploads/evidences', express.static(uploadDir));
app.use(express.static(publicDir));

// HTML Page Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/dashboard', (req, res) => {
  if (req.query.page === 'login') {
    return res.redirect('/');
  }
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

// Mount REST API
app.use('/api/v1', apiRoutes);

// Fallback 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    status: 'fail',
    code: 'NOT_FOUND',
    message: `Rute API '${req.originalUrl}' tidak ditemukan`
  });
});

// Centralized Error Handler
app.use(errorMiddleware);

module.exports = app;

