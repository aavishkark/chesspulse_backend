import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback'
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                console.log('=== STRATEGY CALLBACK TRIGGERED ===');
                console.log('Profile ID:', profile.id);
                const email = profile.emails[0].value;
                const googleId = profile.id;
                const avatar = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null;
                const displayName = profile.displayName;

                let user = await User.findOne({ googleId });

                if (user) {
                    user.lastLogin = new Date();
                    await user.save();
                    return done(null, user);
                }

                user = await User.findOne({ email });

                if (user) {
                    if (user.provider === 'local') {
                        user.googleId = googleId;
                        user.provider = 'google';
                        if (avatar) user.avatar = avatar;
                        user.lastLogin = new Date();
                        await user.save();
                        return done(null, user);
                    } else {
                        user.lastLogin = new Date();
                        await user.save();
                        return done(null, user);
                    }
                }

                const newUser = await User.create({
                    email,
                    googleId,
                    provider: 'google',
                    username: displayName || email.split('@')[0],
                    avatar: avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
                    lastLogin: new Date()
                });

                return done(null, newUser);
            } catch (error) {
                console.error('Google OAuth strategy error:', error);
                return done(error, null);
            }
        }
    )
);

export default passport;
