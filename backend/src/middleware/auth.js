const jwt = require('jsonwebtoken');

// JWT-only auth. Profile Stats backend does NOT own the users table; it trusts
// JWTs minted by Stats Editor backend (shared JWT_SECRET). Account-level checks
// (deactivated/etc) happen via the subscription middleware's remote call when needed.
const authenticateToken = (req, res, next) => {
  try {
    const header = req.headers['authorization'];
    const token = header && header.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    req.user = {
      id: decoded.userId,
      email: decoded.email || null
    };
    req.authToken = token;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('[auth] middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = { authenticateToken };
