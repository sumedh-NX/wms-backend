require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const dispatchRoutes = require('./routes/dispatch');
const adminRoutes = require('./routes/admin');
const { errorHandler } = require('./middleware/error');
const setupRoutes = require('./routes/setup');
const { verifyToken } = require('./middleware/auth');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

// --- PUBLIC ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api/setup', setupRoutes); 

// --- PROTECTED ROUTES ---
// This middleware ensures every request below this line has a valid JWT
app.use('/api', verifyToken);

// Role-based groups (all these now require verifyToken)
app.use('/api/customers', customerRoutes);
app.use('/api/dispatch', dispatchRoutes); // Singular
app.use('/api/admin', adminRoutes);       // Merged User & Strategy management

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} - v2 clean`);
});
