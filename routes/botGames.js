import express from 'express';
import { authenticate } from '../middleware/auth.js';
import BotGame from '../models/BotGame.js';

const router = express.Router();

router.post('/record', authenticate, async (req, res) => {
    try {
        const {
            botId,
            botName,
            botElo,
            playerColor,
            result,
            endReason,
            moves,
            finalFen,
            durationMs
        } = req.body;

        if (!botId || !botName || !playerColor || !result) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: botId, botName, playerColor, result'
            });
        }

        const game = await BotGame.create({
            user: req.user._id,
            botId,
            botName,
            botElo: botElo || 1200,
            playerColor,
            result,
            endReason: endReason || 'checkmate',
            moves: moves || [],
            finalFen,
            totalMoves: moves?.length || 0,
            durationMs: durationMs || 0
        });

        res.status(201).json({
            success: true,
            message: 'Game recorded successfully',
            data: {
                gameId: game._id,
                result: game.result,
                totalMoves: game.totalMoves
            }
        });

    } catch (error) {
        console.error('Error recording bot game:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record game'
        });
    }
});

router.get('/history', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20, botId } = req.query;

        const query = { user: req.user._id };
        if (botId) {
            query.botId = botId;
        }

        const games = await BotGame.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .select('botId botName botElo playerColor result endReason totalMoves durationMs createdAt');

        const total = await BotGame.countDocuments(query);

        res.json({
            success: true,
            data: {
                games,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        console.error('Error fetching bot game history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch game history'
        });
    }
});

router.get('/stats', authenticate, async (req, res) => {
    try {
        const botStats = await BotGame.getUserBotStats(req.user._id);
        const overallStats = await BotGame.getUserOverallStats(req.user._id);

        res.json({
            success: true,
            data: {
                overall: overallStats,
                byBot: botStats
            }
        });

    } catch (error) {
        console.error('Error fetching bot game stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch stats'
        });
    }
});

router.get('/:gameId', authenticate, async (req, res) => {
    try {
        const game = await BotGame.findOne({
            _id: req.params.gameId,
            user: req.user._id
        });

        if (!game) {
            return res.status(404).json({
                success: false,
                message: 'Game not found'
            });
        }

        res.json({
            success: true,
            data: game
        });

    } catch (error) {
        console.error('Error fetching bot game:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch game'
        });
    }
});

export default router;
