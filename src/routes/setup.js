// src/routes/setup.js
/**
 * Temporary route used only for the very first admin creation.
 * After you have at least one user, delete this file (or protect it).
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');

// ---------------------------------------------------------------
// POST /api/setup/admin  – creates the first admin user (no auth)
// ---------------------------------------------------------------
router.post('/admin', async (req, res, next) => {
  try {
    const { email, password, role } = req.body;

    // Basic validation
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'email, password and role are required' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert into DB
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, role`,
      [email, passwordHash, role]
    );

    res.status(201).json(rows[0]);   // return the newly created user
  } catch (err) {
    // If the email already exists we get a unique‑constraint violation
    if (err.code === '23505') {
      return res.status(409).json({ message: 'User with this email already exists' });
    }
    next(err);
  }
});

module.exports = router;
