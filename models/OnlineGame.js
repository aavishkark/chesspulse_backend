import mongoose from 'mongoose';

const onlineGameSchema = new mongoose.Schema({
    white: {
        odId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        odId: { type: String },
        username: { type: String, required: true },
        rating: { type: Number, required: true }
    },
    black: {
        odId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        odId: { type: String },
        username: { type: String, required: true },
        rating: { type: Number, required: true }
    },
    result: {
        type: String,
        enum: ['white', 'black', 'draw', 'aborted'],
        required: true
    },
    resultReason: {
        type: String,
        enum: ['checkmate', 'resignation', 'timeout', 'stalemate', 'insufficient', 'repetition', 'agreement', 'disconnect', 'aborted'],
        default: 'checkmate'
    },
    timeControl: {
        type: String,
        required: true
    },
    ratingCategory: {
        type: String,
        enum: ['bullet', 'blitz', 'rapid'],
        required: true
    },
    ratingChanges: {
        white: { type: Number, default: 0 },
        black: { type: Number, default: 0 }
    },
    moves: [{
        type: String
    }],
    pgn: {
        type: String
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    endedAt: {
        type: Date
    }
}, {
    timestamps: true
});

onlineGameSchema.index({ 'white.odId': 1, createdAt: -1 });
onlineGameSchema.index({ 'black.odId': 1, createdAt: -1 });
onlineGameSchema.index({ ratingCategory: 1, createdAt: -1 });

const OnlineGame = mongoose.model('OnlineGame', onlineGameSchema);

export default OnlineGame;
