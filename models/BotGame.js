import mongoose from 'mongoose';

const botGameSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    botId: {
        type: String,
        required: true,
        index: true
    },

    botName: {
        type: String,
        required: true
    },

    botElo: {
        type: Number,
        required: true
    },

    playerColor: {
        type: String,
        enum: ['white', 'black'],
        required: true
    },

    result: {
        type: String,
        enum: ['win', 'loss', 'draw'],
        required: true
    },

    endReason: {
        type: String,
        enum: ['checkmate', 'resignation', 'stalemate', 'draw', 'timeout', 'agreement'],
        default: 'checkmate'
    },

    moves: [{
        type: String
    }],

    finalFen: {
        type: String
    },

    totalMoves: {
        type: Number,
        default: 0
    },

    durationMs: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

botGameSchema.index({ user: 1, createdAt: -1 });
botGameSchema.index({ botId: 1, result: 1 });

botGameSchema.virtual('durationFormatted').get(function () {
    const totalSeconds = Math.floor(this.durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

botGameSchema.statics.getUserBotStats = async function (userId) {
    const stats = await this.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: '$botId',
                totalGames: { $sum: 1 },
                wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
                botName: { $first: '$botName' },
                botElo: { $first: '$botElo' }
            }
        },
        {
            $project: {
                botId: '$_id',
                botName: 1,
                botElo: 1,
                totalGames: 1,
                wins: 1,
                losses: 1,
                draws: 1,
                winRate: {
                    $multiply: [
                        { $divide: ['$wins', { $max: ['$totalGames', 1] }] },
                        100
                    ]
                }
            }
        },
        { $sort: { botElo: 1 } }
    ]);

    return stats;
};

botGameSchema.statics.getUserOverallStats = async function (userId) {
    const result = await this.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: null,
                totalGames: { $sum: 1 },
                wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
                avgDuration: { $avg: '$durationMs' },
                avgMoves: { $avg: '$totalMoves' }
            }
        }
    ]);

    return result[0] || {
        totalGames: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        avgDuration: 0,
        avgMoves: 0
    };
};

const BotGame = mongoose.model('BotGame', botGameSchema);

export default BotGame;
