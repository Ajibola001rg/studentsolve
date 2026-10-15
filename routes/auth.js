const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { run, get } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, institution, password } = req.body;
    if (!fullName || !email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Invalid input fields. Password must be 6+ chars.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await run(
      'INSERT INTO users (full_name, email, institution, password_hash) VALUES (?, ?, ?, ?)',
      [fullName.trim(), cleanEmail, institution ? institution.trim() : '', hash]
    );

    const token = jwt.sign(
      { id: result.lastID, email: cleanEmail, role: 'student', name: fullName.trim() },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: result.lastID,
        name: fullName.trim(),
        email: cleanEmail,
        institution: institution || '',
        role: 'student'
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Registration failed due to a server error.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.full_name },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        institution: user.institution,
        role: user.role
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server authentication failed' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await get('SELECT id, full_name, email, institution, role FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;