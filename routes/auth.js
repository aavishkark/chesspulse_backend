import express from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { successResponse, errorResponse, unauthorizedResponse } from '../utils/responseHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

const registerValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const refreshValidation = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
];

router.post('/register', authLimiter, validate(registerValidation), async (req, res, next) => {
  try {
    const { email, username, password } = req.body;

    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return errorResponse(res, 'Email already registered', 409);
      }
      return errorResponse(res, 'Username already taken', 409);
    }

    const user = new User({
      email,
      username,
      password,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`
    });

    await user.save();

    const accessToken = generateAccessToken(user._id, user.email);
    const refreshToken = generateRefreshToken(user._id);

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await RefreshToken.create({
      userId: user._id,
      tokenHash,
      expiresAt
    });

    const userData = user.toJSON();

    return successResponse(res, {
      user: userData,
      accessToken,
      refreshToken
    }, 'User registered successfully', 201);

  } catch (error) {
    next(error);
  }
});

router.post('/login', authLimiter, validate(loginValidation), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return unauthorizedResponse(res, 'Invalid email or password');
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return unauthorizedResponse(res, 'Invalid email or password');
    }

    user.lastLogin = new Date();
    await user.save();

    const accessToken = generateAccessToken(user._id, user.email);
    const refreshToken = generateRefreshToken(user._id);

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await RefreshToken.create({
      userId: user._id,
      tokenHash,
      expiresAt
    });

    const userData = user.toJSON();

    return successResponse(res, {
      user: userData,
      accessToken,
      refreshToken
    }, 'Login successful');

  } catch (error) {
    next(error);
  }
});

router.post('/refresh', validate(refreshValidation), async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    const decoded = verifyRefreshToken(refreshToken);

    const storedToken = await RefreshToken.findOne({
      userId: decoded.userId,
      expiresAt: { $gt: new Date() }
    });

    if (!storedToken) {
      return unauthorizedResponse(res, 'Invalid or expired refresh token');
    }

    const user = await User.findById(decoded.userId);

    if (!user) {
      return unauthorizedResponse(res, 'User not found');
    }

    const newAccessToken = generateAccessToken(user._id, user.email);

    return successResponse(res, {
      accessToken: newAccessToken
    }, 'Token refreshed successfully');

  } catch (error) {
    return unauthorizedResponse(res, 'Invalid or expired refresh token');
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await RefreshToken.deleteMany({ userId: req.userId });

    return successResponse(res, null, 'Logout successful');

  } catch (error) {
    next(error);
  }
});

router.get('/verify', authenticate, async (req, res, next) => {
  try {
    return successResponse(res, {
      user: req.user
    }, 'Token verified successfully');
  } catch (error) {
    next(error);
  }
});

export default router;