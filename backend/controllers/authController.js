const authService = require('../services/authService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function register(req, res, next) {
  try {
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' }
      });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Name, email, and password are required.' }
      });
    }

    const existingUser = await authService.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        error: { code: 'EMAIL_ALREADY_EXISTS', message: 'User with this email already exists.' }
      });
    }

    const newUser = await authService.registerUser({ name, email, password });

    res.status(201).json({
      message: 'User registered successfully',
      user: { id: newUser.id, name: newUser.name, email: newUser.email }
    });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' }
      });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' }
      });
    }

    const user = await authService.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      message: 'Logged in successfully',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login
};