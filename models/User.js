import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  username: {
    type: String,
    required: function () {
      return this.provider === 'local';
    },
    unique: true,
    sparse: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [20, 'Username must not exceed 20 characters']
  },
  password: {
    type: String,
    required: function () {
      return this.provider === 'local';
    },
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  provider: {
    type: String,
    enum: ['local', 'google', 'github'],
    default: 'local',
    required: true
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  githubId: {
    type: String,
    unique: true,
    sparse: true
  },
  avatar: {
    type: String,
    default: 'https://api.dicebear.com/7.x/avataaars/svg?seed=default'
  },
  country: {
    type: String,
    default: null
  },
  chesscomUsername: {
    type: String,
    default: null,
    trim: true
  },
  lichessUsername: {
    type: String,
    default: null,
    trim: true
  },
  ratings: {
    bullet: {
      rating: { type: Number, default: 1200 },
      highestRating: { type: Number, default: 1200 },
      ratingHistory: [{
        rating: Number,
        date: { type: Date, default: Date.now }
      }],
      gamesPlayed: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      detailedStats: {
        white: { gamesPlayed: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
        black: { gamesPlayed: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
        outcomes: {
          timeout: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          checkmate: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          resignation: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          stalemate: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          repetition: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          insufficient: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          abandonment: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } }
        }
      }
    },
    blitz: {
      rating: { type: Number, default: 1200 },
      highestRating: { type: Number, default: 1200 },
      ratingHistory: [{
        rating: Number,
        date: { type: Date, default: Date.now }
      }],
      gamesPlayed: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      detailedStats: {
        white: { gamesPlayed: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
        black: { gamesPlayed: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
        outcomes: {
          timeout: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          checkmate: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          resignation: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          stalemate: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          repetition: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          insufficient: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          abandonment: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } }
        }
      }
    },
    rapid: {
      rating: { type: Number, default: 1200 },
      highestRating: { type: Number, default: 1200 },
      ratingHistory: [{
        rating: Number,
        date: { type: Date, default: Date.now }
      }],
      gamesPlayed: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      detailedStats: {
        white: { gamesPlayed: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
        black: { gamesPlayed: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
        outcomes: {
          timeout: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          checkmate: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          resignation: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          stalemate: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          repetition: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          insufficient: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } },
          abandonment: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, draws: { type: Number, default: 0 } }
        }
      }
    }
  },
  lastLogin: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const User = mongoose.model('User', userSchema);

export default User;