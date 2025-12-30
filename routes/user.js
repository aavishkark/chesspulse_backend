import express from 'express';
import { body } from 'express-validator';
import User from '../models/User.js';
import { successResponse, errorResponse } from '../utils/responseHandler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    return successResponse(res, {
      user
    }, 'Profile fetched successfully');

  } catch (error) {
    next(error);
  }
});

const updateProfileValidation = [
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters'),
  body('avatar')
    .optional()
    .trim()
    .isURL()
    .withMessage('Avatar must be a valid URL'),
  body('country')
    .optional()
    .trim()
];

router.put('/profile', authenticate, validate(updateProfileValidation), async (req, res, next) => {
  try {
    const { username, avatar, country } = req.body;

    const updateData = {};
    if (username) {
      const existingUser = await User.findOne({ username, _id: { $ne: req.userId } });
      if (existingUser) {
        return errorResponse(res, 'Username already taken', 409);
      }
      updateData.username = username;
    }
    if (avatar) updateData.avatar = avatar;
    if (country !== undefined) updateData.country = country;

    const user = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true, runValidators: true }
    );

    return successResponse(res, { user }, 'Profile updated successfully');

  } catch (error) {
    next(error);
  }
});

export default router;