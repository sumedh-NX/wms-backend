require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes     = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const dispatchRoutes = require('./routes/dispatch');
const adminRoutes    = require('./routes/admin');
const { errorHandler } = require('./middleware/error');
const setupRoutes    = require('./routes/setup');
const { verifyToken } = require('./middleware/auth');
const CUSTOMER_REGISTRY = require('./customers/registry');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

// --- PUBLIC ROUTES ---
app.use('/api/auth',  authRoutes);
app.use('/api/setup', setupRoutes);

// --- PROTECTED ROUTES ---
app.use('/api', verifyToken);

app.use('/api/customers', customerRoutes);

// Auto-mount all customer workflow routes (specific FIRST)
for (const customer of CUSTOMER_REGISTRY) {
  app.use('/api/dispatch', customer.routes);
}

app.use('/api/dispatch', dispatchRoutes);  // generic routes LAST
app.use('/api/admin',    adminRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} - modular customer plugin`);
});
