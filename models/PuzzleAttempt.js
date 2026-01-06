import mongoose from 'mongoose';

const puzzleAttemptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  puzzleId: {
    type: String,
    required: true
  },
  solved: {
    type: Boolean,
    required: true
  },
  timeMs: {
    type: Number,
    default: 0
  },
  puzzleRating: {
    type: Number,
    required: true
  },
  userRatingBefore: {
    type: Number,
    required: true
  },
  userRatingAfter: {
    type: Number,
    required: true
  },
  ratingChange: {
    type: Number,
    required: true
  },
  themes: [{
    type: String
  }],
  mode: {
    type: String,
    enum: ['rush', 'survival', 'rated', 'themed', 'daily'],
    required: true
  },
  difficulty: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'expert', 'all'],
    default: 'all'
  },
  moveCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

puzzleAttemptSchema.index({ userId: 1, createdAt: -1 });
puzzleAttemptSchema.index({ userId: 1, mode: 1 });
puzzleAttemptSchema.index({ userId: 1, themes: 1 });
puzzleAttemptSchema.index({ createdAt: -1 });

const PuzzleAttempt = mongoose.model('PuzzleAttempt', puzzleAttemptSchema);

export default PuzzleAttempt;
