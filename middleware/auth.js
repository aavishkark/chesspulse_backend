import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';
import { unauthorizedResponse } from '../utils/responseHandler.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorizedResponse(res, 'No token provided');
    }

    const token = authHeader.substring(7);

    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return unauthorizedResponse(res, 'User not found');
    }

    req.user = user;
    req.userId = user._id;

    next();
  } catch (error) {
    if (error.message.includes('expired')) {
      return unauthorizedResponse(res, 'Token expired');
    }
    return unauthorizedResponse(res, 'Invalid token');
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.userId).select('-password');

    if (user) {
      req.user = user;
      req.userId = user._id;
    }

    next();
  } catch (error) {
    next();
  }
};

export const authenticateToken = authenticate;