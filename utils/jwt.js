import jwt from 'jsonwebtoken';
import authConfig from '../config/auth.js';

export const generateAccessToken = (userId, email) => {
  const payload = {
    userId,
    email,
    type: authConfig.tokenTypes.ACCESS
  };

  return jwt.sign(payload, authConfig.jwtSecret, {
    expiresIn: authConfig.jwtExpiresIn
  });
};

export const generateRefreshToken = (userId) => {
  const payload = {
    userId,
    type: authConfig.tokenTypes.REFRESH
  };

  return jwt.sign(payload, authConfig.refreshTokenSecret, {
    expiresIn: authConfig.refreshTokenExpiresIn
  });
};

export const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret);
    
    if (decoded.type !== authConfig.tokenTypes.ACCESS) {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired access token');
  }
};

export const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, authConfig.refreshTokenSecret);
    
    if (decoded.type !== authConfig.tokenTypes.REFRESH) {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
};