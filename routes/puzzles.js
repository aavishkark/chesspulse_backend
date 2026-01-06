import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { successResponse, errorResponse } from '../utils/responseHandler.js';
import PuzzleAttempt from '../models/PuzzleAttempt.js';
import UserPuzzleStats from '../models/UserPuzzleStats.js';
import User from '../models/User.js';
import geminiService from '../utils/geminiService.js';

const router = express.Router();

const K_FACTOR = 32;

function calculateEloChange(playerRating, puzzleRating, solved) {
    const expectedScore = 1 / (1 + Math.pow(10, (puzzleRating - playerRating) / 400));
    const actualScore = solved ? 1 : 0;
    const change = Math.round(K_FACTOR * (actualScore - expectedScore));
    return change;
}

function getDifficultyTier(rating) {
    if (rating < 1200) return 'beginner';
    if (rating < 1600) return 'intermediate';
    if (rating < 2000) return 'advanced';
    return 'expert';
}

router.post('/attempt', authenticate, async (req, res) => {
    try {
        const { puzzleId, solved, timeMs, puzzleRating, themes, mode, difficulty, moveCount } = req.body;
        const userId = req.userId;

        if (!puzzleId || solved === undefined || !puzzleRating || !mode) {
            return errorResponse(res, 'Missing required fields: puzzleId, solved, puzzleRating, mode', 400);
        }

        let stats = await UserPuzzleStats.getOrCreate(userId);

        const userRatingBefore = stats.rating;
        const ratingChange = calculateEloChange(userRatingBefore, puzzleRating, solved);
        const userRatingAfter = Math.max(100, userRatingBefore + ratingChange);

        const attempt = await PuzzleAttempt.create({
            userId,
            puzzleId,
            solved,
            timeMs: timeMs || 0,
            puzzleRating,
            userRatingBefore,
            userRatingAfter,
            ratingChange,
            themes: themes || [],
            mode,
            difficulty: difficulty || 'all',
            moveCount: moveCount || 0
        });

        stats.rating = userRatingAfter;
        if (userRatingAfter > stats.peakRating) {
            stats.peakRating = userRatingAfter;
        }

        stats.totalAttempted += 1;
        if (solved) {
            stats.totalSolved += 1;
        }

        stats.ratingHistory.push({
            date: new Date(),
            rating: userRatingAfter
        });

        if (stats.ratingHistory.length > 100) {
            stats.ratingHistory = stats.ratingHistory.slice(-100);
        }

        stats.updateStreak(solved);

        if (themes && themes.length > 0) {
            themes.forEach(theme => {
                const themeLower = theme.toLowerCase();
                if (!stats.themeStats.has(themeLower)) {
                    stats.themeStats.set(themeLower, { solved: 0, attempted: 0 });
                }
                const themeStat = stats.themeStats.get(themeLower);
                themeStat.attempted += 1;
                if (solved) themeStat.solved += 1;
                stats.themeStats.set(themeLower, themeStat);
            });
        }

        const diffTier = getDifficultyTier(puzzleRating);
        if (stats.difficultyStats[diffTier]) {
            stats.difficultyStats[diffTier].attempted += 1;
            if (solved) stats.difficultyStats[diffTier].solved += 1;
        }

        if (stats.modeStats[mode]) {
            stats.modeStats[mode].attempted += 1;
            if (solved) stats.modeStats[mode].solved += 1;
        }

        if (timeMs) {
            stats.totalTimeMs += timeMs;
            stats.averageTimeMs = Math.round(stats.totalTimeMs / stats.totalAttempted);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let todayStats = stats.dailyHistory.find(d => {
            const dDate = new Date(d.date);
            dDate.setHours(0, 0, 0, 0);
            return dDate.getTime() === today.getTime();
        });

        if (todayStats) {
            todayStats.attempted += 1;
            if (solved) todayStats.solved += 1;
            todayStats.rating = userRatingAfter;
        } else {
            stats.dailyHistory.push({
                date: today,
                solved: solved ? 1 : 0,
                attempted: 1,
                rating: userRatingAfter
            });
        }

        if (stats.dailyHistory.length > 30) {
            stats.dailyHistory = stats.dailyHistory.slice(-30);
        }

        stats.lastActive = new Date();
        await stats.save();

        return successResponse(res, {
            attemptId: attempt._id,
            newRating: userRatingAfter,
            ratingChange,
            peakRating: stats.peakRating,
            streak: {
                current: stats.currentStreak,
                best: stats.bestStreak
            },
            totals: {
                solved: stats.totalSolved,
                attempted: stats.totalAttempted
            }
        }, 'Puzzle attempt recorded');

    } catch (error) {
        console.error('Error recording puzzle attempt:', error);
        return errorResponse(res, 'Failed to record puzzle attempt', 500);
    }
});

router.get('/rating', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const stats = await UserPuzzleStats.getOrCreate(userId);

        return successResponse(res, {
            rating: stats.rating,
            peakRating: stats.peakRating,
            ratingHistory: stats.ratingHistory.slice(-50).map(r => ({
                date: r.date,
                rating: r.rating
            })),
            modeStats: {
                solved: stats.modeStats.rated?.solved || 0,
                attempted: stats.modeStats.rated?.attempted || 0
            }
        }, 'Rating fetched');

    } catch (error) {
        console.error('Error fetching rating:', error);
        return errorResponse(res, 'Failed to fetch rating', 500);
    }
});

router.get('/stats', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const stats = await UserPuzzleStats.getOrCreate(userId);

        const accuracy = stats.totalAttempted > 0
            ? Math.round((stats.totalSolved / stats.totalAttempted) * 100)
            : 0;

        const themeStatsObj = {};
        stats.themeStats.forEach((value, key) => {
            themeStatsObj[key] = {
                ...value,
                accuracy: value.attempted > 0 ? Math.round((value.solved / value.attempted) * 100) : 0
            };
        });

        const topThemes = Object.entries(themeStatsObj)
            .sort((a, b) => b[1].attempted - a[1].attempted)
            .slice(0, 10);

        const weakThemes = Object.entries(themeStatsObj)
            .filter(([_, v]) => v.attempted >= 5)
            .sort((a, b) => a[1].accuracy - b[1].accuracy)
            .slice(0, 5);

        return successResponse(res, {
            rating: stats.rating,
            peakRating: stats.peakRating,
            ratingHistory: stats.ratingHistory.slice(-30),
            totalSolved: stats.totalSolved,
            totalAttempted: stats.totalAttempted,
            accuracy,
            streak: {
                current: stats.currentStreak,
                best: stats.bestStreak
            },
            themeStats: themeStatsObj,
            topThemes,
            weakThemes,
            difficultyStats: stats.difficultyStats,
            modeStats: stats.modeStats,
            dailyHistory: stats.dailyHistory.slice(-14),
            averageTimeMs: stats.averageTimeMs,
            lastActive: stats.lastActive
        }, 'Stats retrieved successfully');

    } catch (error) {
        console.error('Error fetching stats:', error);
        return errorResponse(res, 'Failed to fetch stats', 500);
    }
});

router.get('/history', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { page = 1, limit = 20, mode, theme } = req.query;

        const query = { userId };
        if (mode) query.mode = mode;
        if (theme) query.themes = { $in: [theme.toLowerCase()] };

        const attempts = await PuzzleAttempt.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .lean();

        const total = await PuzzleAttempt.countDocuments(query);

        return successResponse(res, {
            attempts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        }, 'History retrieved');

    } catch (error) {
        console.error('Error fetching history:', error);
        return errorResponse(res, 'Failed to fetch history', 500);
    }
});

router.get('/leaderboard', async (req, res) => {
    try {
        const { type = 'rating', limit = 50 } = req.query;

        let sortField;
        let displayField;

        switch (type) {
            case 'streak':
                sortField = 'bestStreak';
                displayField = 'bestStreak';
                break;
            case 'solved':
                sortField = 'totalSolved';
                displayField = 'totalSolved';
                break;
            case 'rating':
            default:
                sortField = 'rating';
                displayField = 'rating';
        }

        const stats = await UserPuzzleStats.find({ totalAttempted: { $gte: 10 } })
            .sort({ [sortField]: -1 })
            .limit(parseInt(limit))
            .populate('userId', 'username avatar country')
            .lean();

        const leaderboard = stats.map((stat, index) => ({
            rank: index + 1,
            userId: stat.userId?._id,
            username: stat.userId?.username || 'Anonymous',
            avatar: stat.userId?.avatar,
            country: stat.userId?.country,
            value: stat[displayField],
            rating: stat.rating,
            totalSolved: stat.totalSolved,
            bestStreak: stat.bestStreak,
            accuracy: stat.totalAttempted > 0
                ? Math.round((stat.totalSolved / stat.totalAttempted) * 100)
                : 0
        }));

        return successResponse(res, {
            type,
            leaderboard
        }, 'Leaderboard retrieved');

    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        return errorResponse(res, 'Failed to fetch leaderboard', 500);
    }
});

router.get('/leaderboard/rank', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { type = 'rating' } = req.query;

        let sortField;
        switch (type) {
            case 'streak':
                sortField = 'bestStreak';
                break;
            case 'solved':
                sortField = 'totalSolved';
                break;
            default:
                sortField = 'rating';
        }

        const userStats = await UserPuzzleStats.findOne({ userId });
        if (!userStats) {
            return successResponse(res, { rank: null, value: null }, 'No stats yet');
        }

        const rank = await UserPuzzleStats.countDocuments({
            totalAttempted: { $gte: 10 },
            [sortField]: { $gt: userStats[sortField] }
        }) + 1;

        const totalUsers = await UserPuzzleStats.countDocuments({ totalAttempted: { $gte: 10 } });

        return successResponse(res, {
            rank,
            totalUsers,
            value: userStats[sortField],
            percentile: totalUsers > 0 ? Math.round(((totalUsers - rank + 1) / totalUsers) * 100) : 0
        }, 'Rank retrieved');

    } catch (error) {
        console.error('Error fetching rank:', error);
        return errorResponse(res, 'Failed to fetch rank', 500);
    }
});

router.get('/recommend', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const stats = await UserPuzzleStats.getOrCreate(userId);

        const accuracy = stats.totalAttempted > 0
            ? Math.round((stats.totalSolved / stats.totalAttempted) * 100)
            : 0;

        const weakThemes = [];
        const strongThemes = [];
        stats.themeStats.forEach((value, key) => {
            if (value.attempted >= 5) {
                const themeAccuracy = Math.round((value.solved / value.attempted) * 100);
                if (themeAccuracy < 50) {
                    weakThemes.push({ theme: key, accuracy: themeAccuracy, attempted: value.attempted });
                } else if (themeAccuracy >= 70) {
                    strongThemes.push({ theme: key, accuracy: themeAccuracy, attempted: value.attempted });
                }
            }
        });
        weakThemes.sort((a, b) => a.accuracy - b.accuracy);
        strongThemes.sort((a, b) => b.accuracy - a.accuracy);

        let ratingTrend = 'stable';
        if (stats.ratingHistory.length >= 5) {
            const recent = stats.ratingHistory.slice(-5);
            const diff = recent[recent.length - 1].rating - recent[0].rating;
            if (diff > 20) ratingTrend = 'improving';
            else if (diff < -20) ratingTrend = 'declining';
        }

        const aiAdvice = await geminiService.getCoachingAdvice({
            rating: stats.rating,
            peakRating: stats.peakRating,
            totalSolved: stats.totalSolved,
            totalAttempted: stats.totalAttempted,
            accuracy,
            currentStreak: stats.currentStreak,
            bestStreak: stats.bestStreak,
            weakThemes: weakThemes.slice(0, 3),
            strongThemes: strongThemes.slice(0, 3),
            ratingTrend
        });

        return successResponse(res, {
            ...aiAdvice,
            stats: {
                rating: stats.rating,
                accuracy,
                streak: stats.currentStreak,
                weakThemes: weakThemes.slice(0, 3),
                strongThemes: strongThemes.slice(0, 3)
            }
        }, 'AI recommendations generated');

    } catch (error) {
        console.error('Error generating recommendations:', error);
        return errorResponse(res, 'Failed to generate recommendations', 500);
    }
});

router.post('/explain', authenticate, async (req, res) => {
    try {
        const { puzzleId, fen, moves, userMove, solved, themes, rating } = req.body;

        if (!fen || !moves) {
            return errorResponse(res, 'Missing required fields: fen, moves', 400);
        }

        const explanation = await geminiService.explainPuzzle({
            puzzleId,
            fen,
            moves,
            userMove,
            solved,
            themes,
            rating
        });

        return successResponse(res, explanation, 'Puzzle explanation generated');

    } catch (error) {
        console.error('Error explaining puzzle:', error);
        return errorResponse(res, 'Failed to explain puzzle', 500);
    }
});

router.get('/training-plan', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const stats = await UserPuzzleStats.getOrCreate(userId);

        const accuracy = stats.totalAttempted > 0
            ? Math.round((stats.totalSolved / stats.totalAttempted) * 100)
            : 0;

        const weakThemes = [];
        const strongThemes = [];
        stats.themeStats.forEach((value, key) => {
            if (value.attempted >= 3) {
                const themeAccuracy = Math.round((value.solved / value.attempted) * 100);
                if (themeAccuracy < 50) {
                    weakThemes.push({ theme: key, accuracy: themeAccuracy });
                } else if (themeAccuracy >= 70) {
                    strongThemes.push({ theme: key, accuracy: themeAccuracy });
                }
            }
        });

        const preferredModes = Object.entries(stats.modeStats)
            .sort((a, b) => b[1].attempted - a[1].attempted)
            .slice(0, 2)
            .map(([mode]) => mode);

        const todayStats = stats.dailyHistory.find(d => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dDate = new Date(d.date);
            dDate.setHours(0, 0, 0, 0);
            return dDate.getTime() === today.getTime();
        });

        const avgPuzzlesPerDay = stats.dailyHistory.length > 0
            ? Math.round(stats.dailyHistory.reduce((sum, d) => sum + d.attempted, 0) / stats.dailyHistory.length)
            : 5;

        const trainingPlan = await geminiService.generateTrainingPlan({
            rating: stats.rating,
            accuracy,
            weakThemes,
            strongThemes,
            preferredModes,
            avgPuzzlesPerDay,
            puzzlesToday: todayStats?.attempted || 0
        });

        return successResponse(res, trainingPlan, 'Training plan generated');

    } catch (error) {
        console.error('Error generating training plan:', error);
        return errorResponse(res, 'Failed to generate training plan', 500);
    }
});

router.get('/motivation', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const stats = await UserPuzzleStats.getOrCreate(userId);

        const recentAttempts = await PuzzleAttempt.find({ userId })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        const recentAccuracy = recentAttempts.length > 0
            ? Math.round((recentAttempts.filter(a => a.solved).length / recentAttempts.length) * 100)
            : 0;

        let ratingTrend = 'stable';
        if (stats.ratingHistory.length >= 5) {
            const recent = stats.ratingHistory.slice(-5);
            const diff = recent[recent.length - 1].rating - recent[0].rating;
            if (diff > 20) ratingTrend = 'improving';
            else if (diff < -20) ratingTrend = 'declining';
        }

        const todayStats = stats.dailyHistory.find(d => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dDate = new Date(d.date);
            dDate.setHours(0, 0, 0, 0);
            return dDate.getTime() === today.getTime();
        });

        const motivation = await geminiService.getMotivation({
            currentStreak: stats.currentStreak,
            bestStreak: stats.bestStreak,
            recentAccuracy,
            ratingTrend,
            puzzlesToday: todayStats?.attempted || 0
        });

        return successResponse(res, motivation, 'Motivation generated');

    } catch (error) {
        console.error('Error generating motivation:', error);
        return errorResponse(res, 'Failed to generate motivation', 500);
    }
});

router.post('/session-feedback', authenticate, async (req, res) => {
    try {
        const { mode, solved, failed, totalAttempted, duration, score, streak, avgRating, failedThemes, solvedThemes } = req.body;

        if (!mode || totalAttempted === undefined) {
            return errorResponse(res, 'Missing required fields: mode, totalAttempted', 400);
        }

        const feedback = await geminiService.getSessionFeedback({
            mode,
            solved: solved || 0,
            failed: failed || 0,
            totalAttempted,
            duration,
            score,
            streak,
            avgRating,
            failedThemes,
            solvedThemes
        });

        return successResponse(res, feedback, 'Session feedback generated');

    } catch (error) {
        console.error('Error generating session feedback:', error);
        return errorResponse(res, 'Failed to generate session feedback', 500);
    }
});

export default router;
