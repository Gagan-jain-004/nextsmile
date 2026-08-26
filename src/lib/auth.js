import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hos-session-secret-key-987';

export function generateToken() {
  return jwt.sign({ authenticated: true }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(req) {
  let authHeader = null;
  if (req && req.headers) {
    if (typeof req.headers.get === 'function') {
      authHeader = req.headers.get('authorization');
    } else if (req.headers.authorization) {
      authHeader = req.headers.authorization;
    }
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded && decoded.authenticated === true;
  } catch (err) {
    return false;
  }
}
