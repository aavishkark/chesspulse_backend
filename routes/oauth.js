import express from 'express';
import passport from '../config/passport.js';
import bcrypt from 'bcryptjs';
import RefreshToken from '../models/RefreshToken.js';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';

const router = express.Router();

router.get('/google',
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        session: false
    })
);

router.get('/google/callback', async (req, res, next) => {
    passport.authenticate('google', { session: false }, async (err, user, info) => {
        try {
            console.log('OAuth callback - err:', err, 'user:', !!user);

            if (err) {
                console.error('OAuth error:', err);
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
                return res.redirect(`${frontendUrl}/signin?error=${encodeURIComponent(err.message || 'Authentication failed')}`);
            }

            if (!user) {
                console.error('No user returned from OAuth strategy');
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
                return res.redirect(`${frontendUrl}/signin?error=Authentication%20failed`);
            }

            console.log('Generating tokens for user:', user._id);
            const accessToken = generateAccessToken(user._id, user.email);
            const refreshToken = generateRefreshToken(user._id);

            const tokenHash = await bcrypt.hash(refreshToken, 10);
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            await RefreshToken.create({
                userId: user._id,
                tokenHash,
                expiresAt
            });

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            const redirectUrl = `${frontendUrl}/auth-success?accessToken=${accessToken}&refreshToken=${refreshToken}`;

            console.log('OAuth success - redirecting to frontend');
            return res.redirect(redirectUrl);

        } catch (error) {
            console.error('OAuth callback error:', error);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            return res.redirect(`${frontendUrl}/signin?error=${encodeURIComponent(error.message)}`);
        }
    })(req, res, next);
});

export default router;
