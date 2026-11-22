const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Access token is missing or invalid.' }
    });
  }

  const token = authHeader.split(' ')[1];

  // Fail closed: without the secret no token can be checked, so this is a
  // server misconfiguration (500), not the user's fault.
  if (!process.env.JWT_SECRET) {
    return next(new Error('JWT_SECRET is not set'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; 
    next();
  } catch (error) {
    // 401: the user must sign in again (expired, tampered or malformed token).
    // 403 is kept for a signed-in user who lacks permission for an action.
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Token is expired or invalid. Please sign in again.' }
    });
  }
};

module.exports = verifyToken;