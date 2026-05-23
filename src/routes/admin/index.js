const express = require('express');
const router = express.Router();
const { permit } = require('../../middleware/auth');

const userRoutes       = require('./users');
const customerRoutes   = require('./customers');
const strategyRoutes   = require('./strategies');
const assignmentRoutes = require('./assignments');

router.use(permit('admin'));

router.use('/users',             userRoutes);
router.use('/customers',         customerRoutes);
router.use('/strategies',        strategyRoutes);
router.use('/customer-strategy', assignmentRoutes);
router.use('/customer-strategies', assignmentRoutes);

module.exports = router;
