const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token =
    req.cookies?.token ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : null);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: 'Access forbidden: Administrative rights required' });
    }
  });
}

module.exports = { requireAuth, requireAdmin };