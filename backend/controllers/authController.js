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

    const { name, email, password } = req.body ?? {};

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string'
        || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Name, email, and password are required.' }
      });
    }
    const cleanName = name.trim();
    // Emails are stored in lower case so "Ali@Mail.com" and "ali@mail.com"
    // cannot become two different accounts.
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.length > 150) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Name must be at most 150 characters.' }
      });
    }
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required.' }
      });
    }
    // bcrypt only uses the first 72 bytes of a password, so longer ones are refused.
    if (password.length < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Password must be between 8 and 72 characters.' }
      });
    }

    const existingUser = await authService.findUserByEmail(cleanEmail);
    if (existingUser) {
      return res.status(409).json({
        error: { code: 'EMAIL_ALREADY_EXISTS', message: 'User with this email already exists.' }
      });
    }

    const newUser = await authService.registerUser({ name: cleanName, email: cleanEmail, password });

    res.status(201).json({
      message: 'User registered successfully',
      user: { id: newUser.id, name: newUser.name, email: newUser.email }
    });
  } catch (error) {
    // Two registrations with the same email at the same moment: the UNIQUE
    // constraint in the database stops the second one.
    if (error.code === '23505') {
      return res.status(409).json({
        error: { code: 'EMAIL_ALREADY_EXISTS', message: 'User with this email already exists.' }
      });
    }
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

    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' }
      });
    }

    const user = await authService.findUserByEmail(email.trim().toLowerCase());
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