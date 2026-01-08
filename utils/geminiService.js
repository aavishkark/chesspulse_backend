const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const callGroqAPI = async (systemPrompt, userPrompt) => {
    const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
        }),
    });

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error('Invalid Groq API response:', data);
        throw new Error('Invalid API response structure');
    }

    return data.choices[0].message.content;
};

const safeJSONParse = (text) => {
    try {
        const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        return { raw: text };
    }
};

export const geminiService = {
    async getCoachingAdvice(stats) {
        try {
            const systemPrompt = 'You are a friendly chess puzzle coach. Provide personalized advice in JSON format only.';
            const userPrompt = `Based on these player stats, provide personalized advice.

Player Stats:
- Puzzle Rating: ${stats.rating}
- Peak Rating: ${stats.peakRating || stats.rating}
- Total Solved: ${stats.totalSolved}
- Total Attempted: ${stats.totalAttempted}
- Accuracy: ${stats.accuracy}%
- Current Streak: ${stats.currentStreak} days
- Best Streak: ${stats.bestStreak} days
- Weak Themes: ${stats.weakThemes?.map(t => `${t.theme} (${t.accuracy}%)`).join(', ') || 'None identified yet'}
- Rating Trend: ${stats.ratingTrend || 'stable'}

Respond in JSON format:
{
  "dailyTip": "One specific actionable tip for today (1-2 sentences)",
  "focusArea": "The main theme they should practice (e.g., 'forks', 'pins')",
  "focusReason": "Why they should focus on this (1 sentence)",
  "motivation": "A short encouraging message based on their streak/progress",
  "suggestedDifficulty": "beginner|intermediate|advanced|expert",
  "targetRating": number (suggested puzzle rating to practice),
  "weeklyGoal": "A specific goal for this week"
}`;

            const result = await callGroqAPI(systemPrompt, userPrompt);
            return safeJSONParse(result);
        } catch (error) {
            console.error('Groq coaching error:', error);
            return {
                dailyTip: "Focus on taking your time with each puzzle.",
                focusArea: "tactics",
                focusReason: "Building a strong tactical foundation helps in all areas.",
                motivation: "Keep practicing! Every puzzle makes you stronger.",
                suggestedDifficulty: "intermediate",
                targetRating: stats.rating,
                weeklyGoal: "Solve 10 puzzles with at least 70% accuracy"
            };
        }
    },

    async explainPuzzle(puzzleData) {
        try {
            const systemPrompt = 'You are a chess coach explaining a puzzle. Be concise and educational. Respond in JSON format only.';
            const userPrompt = `Explain this chess puzzle.

Puzzle Info:
- FEN Position: ${puzzleData.fen}
- Puzzle Rating: ${puzzleData.rating}
- Theme/Pattern: ${puzzleData.themes?.join(', ') || 'Unknown'}
- Correct Solution: ${puzzleData.moves?.join(' → ') || 'Unknown'}
- User's Move: ${puzzleData.userMove || 'N/A'}
- User Solved It: ${puzzleData.solved ? 'Yes' : 'No'}

Respond in JSON format:
{
  "pattern": "The main tactical pattern (fork, pin, skewer, mate, etc.)",
  "explanation": "2-3 sentences explaining WHY the correct moves work",
  "keyIdea": "The single most important concept to remember",
  "whatToLook": "What signs should they look for to spot this pattern in games",
  "encouragement": "A brief encouraging word (1 sentence)"
}`;

            const result = await callGroqAPI(systemPrompt, userPrompt);
            return safeJSONParse(result);
        } catch (error) {
            console.error('Groq explanation error:', error);
            return {
                pattern: puzzleData.themes?.[0] || "tactics",
                explanation: "This puzzle tests your tactical awareness. Look for checks, captures, and threats.",
                keyIdea: "Always look for forcing moves first.",
                whatToLook: "Undefended pieces and king safety issues.",
                encouragement: "Great effort! Keep practicing to sharpen your skills."
            };
        }
    },

    async generateTrainingPlan(stats) {
        try {
            const systemPrompt = 'You are a chess training coach. Create a personalized weekly puzzle training plan. Respond in JSON format only.';
            const userPrompt = `Create a weekly puzzle training plan.

Player Profile:
- Current Rating: ${stats.rating}
- Accuracy: ${stats.accuracy}%
- Weak Themes: ${stats.weakThemes?.map(t => `${t.theme} (${t.accuracy}%)`).join(', ') || 'None identified'}
- Strong Themes: ${stats.strongThemes?.map(t => `${t.theme} (${t.accuracy}%)`).join(', ') || 'None identified'}
- Preferred Modes: ${stats.preferredModes?.join(', ') || 'Mixed'}
- Practice Frequency: ${stats.avgPuzzlesPerDay || 5} puzzles/day average

Create a balanced 7-day plan. Respond in JSON format:
{
  "weeklyGoal": "The main objective for this week",
  "dailyPlans": [
    {
      "day": "Monday",
      "focus": "Theme to focus on",
      "puzzleCount": number,
      "difficulty": "beginner|intermediate|advanced|expert",
      "tip": "Specific tip for this session"
    }
  ],
  "milestone": "What they should achieve by end of week",
  "bonusChallenge": "Optional extra challenge for motivated players"
}`;

            const result = await callGroqAPI(systemPrompt, userPrompt);
            return safeJSONParse(result);
        } catch (error) {
            console.error('Groq training plan error:', error);
            return {
                weeklyGoal: "Improve overall puzzle accuracy",
                dailyPlans: [
                    { day: "Monday", focus: "warmup", puzzleCount: 10, difficulty: "intermediate", tip: "Start easy" },
                    { day: "Tuesday", focus: "tactics", puzzleCount: 10, difficulty: "intermediate", tip: "Look for forks" },
                    { day: "Wednesday", focus: "endgame", puzzleCount: 8, difficulty: "intermediate", tip: "King activity is key" },
                    { day: "Thursday", focus: "checkmate patterns", puzzleCount: 10, difficulty: "intermediate", tip: "Practice back rank mates" },
                    { day: "Friday", focus: "mixed", puzzleCount: 10, difficulty: "advanced", tip: "Challenge yourself" },
                    { day: "Saturday", focus: "weak areas", puzzleCount: 12, difficulty: "intermediate", tip: "Focus on improvement" },
                    { day: "Sunday", focus: "fun puzzles", puzzleCount: 5, difficulty: "all", tip: "Enjoy the game!" }
                ],
                milestone: "Improve accuracy by 5%",
                bonusChallenge: "Complete a 10-puzzle streak without mistakes"
            };
        }
    },

    async getMotivation(stats) {
        try {
            const systemPrompt = 'You are an encouraging chess coach. Give a brief, personalized motivational message. Respond in JSON format only.';
            const userPrompt = `Give a motivational message for this player.

Player Context:
- Current Streak: ${stats.currentStreak} days
- Best Streak: ${stats.bestStreak} days
- Recent Performance: ${stats.recentAccuracy}% accuracy in last 10 puzzles
- Rating Trend: ${stats.ratingTrend} (improving/declining/stable)
- Puzzles Today: ${stats.puzzlesToday}

Respond in JSON format:
{
  "message": "A warm, personalized motivational message (2-3 sentences max)",
  "emoji": "A single relevant emoji",
  "challengeTip": "Optional mini-challenge for today (1 sentence)"
}`;

            const result = await callGroqAPI(systemPrompt, userPrompt);
            return safeJSONParse(result);
        } catch (error) {
            console.error('Groq motivation error:', error);
            return {
                message: "Every puzzle you solve makes you a better player. Keep up the great work!",
                emoji: "💪",
                challengeTip: "Try to beat your best streak today!"
            };
        }
    },

    async getSessionFeedback(sessionData) {
        try {
            const accuracy = sessionData.totalAttempted > 0
                ? Math.round((sessionData.solved / sessionData.totalAttempted) * 100)
                : 0;

            const systemPrompt = 'You are a chess coach giving feedback after a puzzle session. Be direct, specific, and actionable. No fluff. Respond in JSON format only.';
            const userPrompt = `Give feedback for this puzzle session.

Session Results:
- Mode: ${sessionData.mode} (${sessionData.mode === 'rush' ? 'timed challenge' : sessionData.mode === 'survival' ? '3 lives' : 'rated'})
- Puzzles Solved: ${sessionData.solved}
- Puzzles Failed: ${sessionData.failed}
- Total Attempted: ${sessionData.totalAttempted}
- Accuracy: ${accuracy}%
- Session Duration: ${sessionData.duration || 'N/A'}
- Final Score/Streak: ${sessionData.score || sessionData.streak || 0}
- Average Puzzle Rating: ${sessionData.avgRating || 'N/A'}
- Themes Struggled With: ${sessionData.failedThemes?.join(', ') || 'None tracked'}
- Themes Succeeded With: ${sessionData.solvedThemes?.join(', ') || 'None tracked'}

Give 2-3 specific, actionable tips. Be direct and helpful.

Respond in JSON format:
{
  "summary": "One sentence summary of their performance (be honest but encouraging)",
  "tips": [
    "First specific tip based on their performance",
    "Second specific tip",
    "Third tip (optional, only if really needed)"
  ],
  "improvement": "One specific thing to work on next session",
  "strength": "One thing they did well (if any)"
}`;

            const result = await callGroqAPI(systemPrompt, userPrompt);
            return safeJSONParse(result);
        } catch (error) {
            console.error('Groq session feedback error:', error);
            return {
                summary: `You completed ${sessionData.solved} puzzles this session.`,
                tips: [
                    "Take your time to analyze the position before moving.",
                    "Look for checks, captures, and threats in that order."
                ],
                improvement: "Focus on accuracy over speed.",
                strength: "You showed persistence!"
            };
        }
    },

    async getCuratedCuration(stats) {
        try {
            const systemPrompt = 'You are a chess puzzle curator. Generate a personalized training plan of 30 puzzles. Respond in JSON format only.';
            const userPrompt = `Create a 30-puzzle training plan based on these user stats.
            
Player Stats:
- Rating: ${stats.rating}
- Weak Themes: ${stats.weakThemes?.map(t => `${t.theme} (${t.accuracy}%)`).join(', ') || 'None identified'}
- Strong Themes: ${stats.strongThemes?.map(t => `${t.theme} (${t.accuracy}%)`).join(', ') || 'None identified'}

Requirements:
- Total puzzles must be 30.
- Distribute counts based on weaknesses (e.g., more puzzles for themes with lower accuracy).
- Include some "confidence builder" puzzles from strong themes (about 10-20%).
- If no weak/strong themes are provided, suggest a diverse mix of 5-6 common tactical themes.

Respond in JSON format:
{
  "themes": [
    { "theme": "string", "count": number, "reason": "why this theme was included" }
  ],
  "totalCount": 30,
  "summary": "Short explanation of this curated set (1-2 sentences)"
}`;

            const result = await callGroqAPI(systemPrompt, userPrompt);
            return safeJSONParse(result);
        } catch (error) {
            console.error('Groq curation error:', error);
            return {
                themes: [
                    { theme: 'mateIn1', count: 10, reason: 'Fundamental skill' },
                    { theme: 'fork', count: 10, reason: 'Common tactic' },
                    { theme: 'pin', count: 10, reason: 'Essential pattern' }
                ],
                totalCount: 30,
                summary: "A balanced set of core tactical patterns."
            };
        }
    }
};

export default geminiService;
