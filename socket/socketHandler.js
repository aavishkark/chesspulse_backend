import User from '../models/User.js';
import OnlineGame from '../models/OnlineGame.js';
import { calculateGameRatings, getRatingCategory } from '../utils/eloCalculator.js';

const openChallenges = new Map();
const activeGames = new Map();
const disconnectTimeouts = new Map();
const RECONNECT_WINDOW = 30000;

async function processGameResult(game, result, reason, io) {
    const ratingCategory = getRatingCategory(game.timeControl);

    console.log('📊 Processing game result:');
    console.log(`   Time Control: ${game.timeControl}`);
    console.log(`   Rating Category: ${ratingCategory}`);

    try {
        const whiteUser = await User.findOne({ username: game.white.username });
        const blackUser = await User.findOne({ username: game.black.username });

        const whiteRating = whiteUser?.ratings?.[ratingCategory]?.rating || 1200;
        const blackRating = blackUser?.ratings?.[ratingCategory]?.rating || 1200;
        const whiteGamesPlayed = whiteUser?.ratings?.[ratingCategory]?.gamesPlayed || 0;
        const blackGamesPlayed = blackUser?.ratings?.[ratingCategory]?.gamesPlayed || 0;

        const ratingResult = calculateGameRatings({
            whiteRating,
            blackRating,
            result,
            whiteGamesPlayed,
            blackGamesPlayed
        });

        const savedGame = await OnlineGame.create({
            white: {
                odId: whiteUser?._id || null,
                odId: game.white.id,
                username: game.white.username,
                rating: whiteRating
            },
            black: {
                odId: blackUser?._id || null,
                odId: game.black.id,
                username: game.black.username,
                rating: blackRating
            },
            result,
            resultReason: reason,
            timeControl: game.timeControl,
            ratingCategory,
            ratingChanges: {
                white: ratingResult.whiteChange,
                black: ratingResult.blackChange
            },
            moves: game.moves,
            startedAt: new Date(game.startTime),
            endedAt: new Date()
        });

        const updateUserStats = async (user, color, newRating, isWin, isDraw) => {
            if (!user) return;

            const stats = user.ratings?.[ratingCategory] || {};
            const currentStreak = stats.currentStreak || 0;
            const bestStreak = stats.bestStreak || 0;
            const highestRating = stats.highestRating || 1200;
            const detailed = stats.detailedStats || { white: {}, black: {}, outcomes: {} };

            let newStreak = 0;
            if (isWin) {
                newStreak = currentStreak > 0 ? currentStreak + 1 : 1;
            } else if (isDraw) {
                newStreak = 0;
            } else {
                newStreak = currentStreak < 0 ? currentStreak - 1 : -1;
            }

            const update = {
                [`ratings.${ratingCategory}.rating`]: newRating,
                [`ratings.${ratingCategory}.gamesPlayed`]: (stats.gamesPlayed || 0) + 1,
                [`ratings.${ratingCategory}.currentStreak`]: newStreak,
                [`ratings.${ratingCategory}.highestRating`]: Math.max(highestRating, newRating)
            };

            if (newStreak > bestStreak) {
                update[`ratings.${ratingCategory}.bestStreak`] = newStreak;
            }

            if (isWin) update[`ratings.${ratingCategory}.wins`] = (stats.wins || 0) + 1;
            else if (isDraw) update[`ratings.${ratingCategory}.draws`] = (stats.draws || 0) + 1;
            else update[`ratings.${ratingCategory}.losses`] = (stats.losses || 0) + 1;

            const colorStats = detailed[color] || { gamesPlayed: 0, wins: 0, losses: 0, draws: 0 };
            update[`ratings.${ratingCategory}.detailedStats.${color}.gamesPlayed`] = (colorStats.gamesPlayed || 0) + 1;

            if (isWin) update[`ratings.${ratingCategory}.detailedStats.${color}.wins`] = (colorStats.wins || 0) + 1;
            else if (isDraw) update[`ratings.${ratingCategory}.detailedStats.${color}.draws`] = (colorStats.draws || 0) + 1;
            else update[`ratings.${ratingCategory}.detailedStats.${color}.losses`] = (colorStats.losses || 0) + 1;

            let outcomeKey = reason;
            if (reason === 'threefold repetition') outcomeKey = 'repetition';
            if (reason === 'insufficient material') outcomeKey = 'insufficient';

            if (['timeout', 'checkmate', 'resignation', 'stalemate', 'repetition', 'insufficient', 'abandonment'].includes(outcomeKey)) {
                const outcomeStats = detailed.outcomes?.[outcomeKey] || { wins: 0, losses: 0, draws: 0 };
                const outcomePath = `ratings.${ratingCategory}.detailedStats.outcomes.${outcomeKey}`;

                if (isWin) update[`${outcomePath}.wins`] = (outcomeStats.wins || 0) + 1;
                else if (isDraw) update[`${outcomePath}.draws`] = (outcomeStats.draws || 0) + 1;
                else update[`${outcomePath}.losses`] = (outcomeStats.losses || 0) + 1;
            }

            const pushUpdate = {
                [`ratings.${ratingCategory}.ratingHistory`]: {
                    rating: newRating,
                    date: new Date(),
                    gameId: savedGame._id
                }
            };

            console.log(`   Updating ${user.username}: ${stats.rating} -> ${newRating} (Streak: ${newStreak})`);
            await User.findByIdAndUpdate(user._id, {
                $set: update,
                $push: pushUpdate
            });
        };

        await updateUserStats(whiteUser, 'white', ratingResult.whiteNewRating, result === 'white', result === 'draw');
        await updateUserStats(blackUser, 'black', ratingResult.blackNewRating, result === 'black', result === 'draw');

        return ratingResult;
    } catch (error) {
        console.error('Error processing game result:', error);
        return {
            whiteChange: 0,
            blackChange: 0,
            whiteNewRating: 1200,
            blackNewRating: 1200
        };
    }
}

function broadcastChallenges(io) {
    const challengeArray = Array.from(openChallenges.values());
    io.emit('challenge_list_updated', challengeArray);
}

export function initializeSocketHandlers(io) {
    io.on('connection', (socket) => {


        socket.on('find_game', (playerData) => {


            const timeControl = playerData?.timeControl || '10+0';
            const username = playerData?.username || 'Guest';
            const rating = playerData?.rating || 1200;

            let matchedChallenge = null;
            for (const [challengeId, challenge] of openChallenges.entries()) {
                if (challenge.timeControl === timeControl && challenge.playerId !== socket.id) {
                    matchedChallenge = { id: challengeId, ...challenge };
                    break;
                }
            }

            if (matchedChallenge) {


                openChallenges.delete(matchedChallenge.id);

                const challengerSocket = io.sockets.sockets.get(matchedChallenge.playerId);
                if (!challengerSocket) {

                    matchedChallenge = null;
                    broadcastChallenges(io);
                } else {
                    const roomId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    const isQuickPlayerWhite = Math.random() < 0.5;
                    const white = isQuickPlayerWhite
                        ? { socket, id: socket.id, username, rating }
                        : { socket: challengerSocket, id: matchedChallenge.playerId, username: matchedChallenge.username, rating: matchedChallenge.rating };
                    const black = isQuickPlayerWhite
                        ? { socket: challengerSocket, id: matchedChallenge.playerId, username: matchedChallenge.username, rating: matchedChallenge.rating }
                        : { socket, id: socket.id, username, rating };

                    white.socket.join(roomId);
                    black.socket.join(roomId);

                    activeGames.set(roomId, {
                        white: { id: white.id, username: white.username, rating: white.rating },
                        black: { id: black.id, username: black.username, rating: black.rating },
                        moves: [],
                        startTime: Date.now(),
                        lastMoveTime: Date.now(),
                        whiteTime: parseInt(timeControl.split('+')[0]) * 60,
                        blackTime: parseInt(timeControl.split('+')[0]) * 60,
                        currentTurn: 'white',
                        timeControl,
                        chatHistory: []
                    });

                    white.socket.emit('game_start', {
                        roomId,
                        color: 'white',
                        opponent: { username: black.username, rating: black.rating },
                        timeControl
                    });

                    black.socket.emit('game_start', {
                        roomId,
                        color: 'black',
                        opponent: { username: white.username, rating: white.rating },
                        timeControl
                    });


                    broadcastChallenges(io);
                    return;
                }
            }

            const challengeId = `challenge_${socket.id}_${Date.now()}`;
            const challenge = {
                id: challengeId,
                playerId: socket.id,
                username: username,
                rating: rating,
                timeControl: timeControl,
                createdAt: Date.now(),
                isQuickPlay: true
            };

            openChallenges.set(challengeId, challenge);

            socket.emit('challenge_created', { challengeId, challenge });

            socket.emit('waiting_for_opponent');

            broadcastChallenges(io);
        });

        socket.on('create_challenge', (data) => {
            console.log('📝 Challenge created with data:', data);
            const challengeId = `challenge_${socket.id}_${Date.now()}`;
            const challenge = {
                id: challengeId,
                playerId: socket.id,
                username: data.username || 'Guest',
                avatar: data.avatar,
                rating: data.rating || 1200,
                timeControl: data.timeControl || '10+0',
                createdAt: Date.now()
            };

            openChallenges.set(challengeId, challenge);


            socket.emit('challenge_created', { challengeId, challenge });

            broadcastChallenges(io);
        });


        socket.on('get_challenges', () => {
            socket.emit('challenge_list_updated', Array.from(openChallenges.values()));
        });

        socket.on('accept_challenge', ({ challengeId, username, rating, avatar }) => {
            const challenge = openChallenges.get(challengeId);

            if (!challenge) {
                socket.emit('error', { message: 'Challenge no longer available' });
                return;
            }

            openChallenges.delete(challengeId);

            const challengerSocket = io.sockets.sockets.get(challenge.playerId);
            if (!challengerSocket) {
                socket.emit('error', { message: 'Challenger disconnected' });
                broadcastChallenges(io);
                return;
            }

            const roomId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const acceptorUsername = username || 'Guest';
            const acceptorRating = rating || 1200;

            const isAcceptorWhite = Math.random() < 0.5;
            const white = isAcceptorWhite
                ? { socket, id: socket.id, username: acceptorUsername, rating: acceptorRating, avatar }
                : { socket: challengerSocket, id: challenge.playerId, username: challenge.username, rating: challenge.rating, avatar: challenge.avatar };
            const black = isAcceptorWhite
                ? { socket: challengerSocket, id: challenge.playerId, username: challenge.username, rating: challenge.rating, avatar: challenge.avatar }
                : { socket, id: socket.id, username: acceptorUsername, rating: acceptorRating, avatar };

            white.socket.join(roomId);
            black.socket.join(roomId);

            activeGames.set(roomId, {
                white: { id: white.id, username: white.username, rating: white.rating, avatar: white.avatar },
                black: { id: black.id, username: black.username, rating: black.rating, avatar: black.avatar },
                moves: [],
                startTime: Date.now(),
                lastMoveTime: Date.now(),
                whiteTime: parseInt(challenge.timeControl.split('+')[0]) * 60,
                blackTime: parseInt(challenge.timeControl.split('+')[0]) * 60,
                currentTurn: 'white',
                timeControl: challenge.timeControl,
                chatHistory: []
            });

            white.socket.emit('game_start', {
                roomId,
                color: 'white',
                opponent: { username: black.username, rating: black.rating, avatar: black.avatar },
                timeControl: challenge.timeControl
            });

            black.socket.emit('game_start', {
                roomId,
                color: 'black',
                opponent: { username: white.username, rating: white.rating, avatar: white.avatar },
                timeControl: challenge.timeControl
            });



            broadcastChallenges(io);
        });

        socket.on('cancel_challenge', ({ challengeId }) => {
            if (openChallenges.has(challengeId)) {
                const challenge = openChallenges.get(challengeId);

                if (challenge.playerId === socket.id) {
                    openChallenges.delete(challengeId);


                    socket.emit('challenge_cancelled', { challengeId });
                    broadcastChallenges(io);
                }
            }
        });

        socket.on('make_move', ({ roomId, move, fen, from, to }) => {
            const game = activeGames.get(roomId);
            if (!game) {
                socket.emit('error', { message: 'Game not found' });
                return;
            }

            const playerColor = game.white.id === socket.id ? 'white' : 'black';
            if (game.currentTurn !== playerColor) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            game.moves.push(move);

            const now = Date.now();
            const timeTaken = (now - game.lastMoveTime) / 1000;
            game.lastMoveTime = now;

            const [minutes, increment] = game.timeControl.split('+').map(Number);
            const inc = increment || 0;

            if (playerColor === 'white') {
                game.whiteTime = Math.max(0, game.whiteTime - timeTaken + inc);
            } else {
                game.blackTime = Math.max(0, game.blackTime - timeTaken + inc);
            }

            game.currentTurn = playerColor === 'white' ? 'black' : 'white';

            if (game.drawOfferedBy && game.drawOfferedBy !== socket.id) {
                game.drawOfferedBy = null;
                socket.to(roomId).emit('draw_declined');
            }

            socket.to(roomId).emit('opponent_move', { move, fen, from, to });


        });

        socket.on('send_chat', ({ roomId, message }) => {
            const game = activeGames.get(roomId);
            if (!game) return;

            const chatMsg = {
                sender: game.white.id === socket.id ? game.white.username : game.black.username,
                message,
                timestamp: Date.now()
            };

            if (!game.chatHistory) game.chatHistory = [];
            game.chatHistory.push(chatMsg);
            io.to(roomId).emit('receive_chat', chatMsg);
        });

        socket.on('game_over', async ({ roomId, result, reason }) => {
            const game = activeGames.get(roomId);
            if (!game) return;

            const ratingResult = await processGameResult(game, result, reason, io);

            io.to(roomId).emit('game_ended', {
                result,
                reason,
                ratingChanges: {
                    white: ratingResult.whiteChange,
                    black: ratingResult.blackChange
                }
            });

            activeGames.delete(roomId);
        });

        socket.on('resign', async ({ roomId }) => {
            const game = activeGames.get(roomId);
            if (!game) return;

            const playerColor = game.white.id === socket.id ? 'white' : 'black';
            const winner = playerColor === 'white' ? 'black' : 'white';

            const ratingResult = await processGameResult(game, winner, 'resignation', io);

            io.to(roomId).emit('game_ended', {
                result: winner,
                reason: `${playerColor} resigned`,
                ratingChanges: {
                    white: ratingResult.whiteChange,
                    black: ratingResult.blackChange
                }
            });

            activeGames.delete(roomId);
        });

        socket.on('offer_draw', ({ roomId }) => {
            const game = activeGames.get(roomId);
            if (!game) return;
            game.drawOfferedBy = socket.id;
            socket.to(roomId).emit('draw_offered');
        });

        socket.on('accept_draw', async ({ roomId }) => {
            const game = activeGames.get(roomId);
            if (!game) return;
            if (!game.drawOfferedBy || game.drawOfferedBy === socket.id) return;

            const ratingResult = await processGameResult(game, 'draw', 'mutual agreement', io);

            io.to(roomId).emit('game_ended', {
                result: 'draw',
                reason: 'mutual agreement',
                ratingChanges: {
                    white: ratingResult.whiteChange,
                    black: ratingResult.blackChange
                }
            });
            activeGames.delete(roomId);
        });

        socket.on('decline_draw', ({ roomId }) => {
            const game = activeGames.get(roomId);
            if (!game) return;
            game.drawOfferedBy = null;
            socket.to(roomId).emit('draw_declined');
        });

        socket.on('rejoin_game', ({ roomId, oldSocketId }) => {
            const game = activeGames.get(roomId);
            if (!game) {
                socket.emit('rejoin_error', { message: 'Game not found or expired' });
                return;
            }

            let playerColor = null;
            if (game.white.id === oldSocketId) playerColor = 'white';
            else if (game.black.id === oldSocketId) playerColor = 'black';

            if (!playerColor) {
                socket.emit('rejoin_error', { message: 'Invalid player credentials' });
                return;
            }

            const timeoutKey = `${roomId}_${playerColor}`;
            if (disconnectTimeouts.has(timeoutKey)) {
                clearTimeout(disconnectTimeouts.get(timeoutKey));
                disconnectTimeouts.delete(timeoutKey);
            }

            if (playerColor === 'white') {
                game.white.id = socket.id;
                game.white.socket = socket;
            } else {
                game.black.id = socket.id;
                game.black.socket = socket;
            }

            socket.join(roomId);

            let currentWhiteTime = game.whiteTime;
            let currentBlackTime = game.blackTime;

            const now = Date.now();
            const timeElapsed = (now - game.lastMoveTime) / 1000;

            if (game.currentTurn === 'white') {
                currentWhiteTime = Math.max(0, currentWhiteTime - timeElapsed);
            } else {
                currentBlackTime = Math.max(0, currentBlackTime - timeElapsed);
            }

            socket.emit('game_rejoined', {
                roomId,
                fen: game.moves.length > 0 ? null : 'start',
                moves: game.moves,
                whiteTime: currentWhiteTime,
                blackTime: currentBlackTime,
                color: playerColor,
                opponent: playerColor === 'white'
                    ? { username: game.black.username, rating: game.black.rating }
                    : { username: game.white.username, rating: game.white.rating },
                myRating: playerColor === 'white' ? game.white.rating : game.black.rating,
                timeControl: game.timeControl,
                currentTurn: game.currentTurn,
                chatHistory: game.chatHistory
            });

            socket.to(roomId).emit('opponent_reconnected', {
                message: 'Opponent reconnected'
            });

            console.log(`Player rejoined game: ${roomId} as ${playerColor} (new socket: ${socket.id})`);
        });

        socket.on('disconnect', () => {


            let challengeRemoved = false;
            for (const [challengeId, challenge] of openChallenges.entries()) {
                if (challenge.playerId === socket.id) {
                    openChallenges.delete(challengeId);
                    challengeRemoved = true;

                }
            }

            if (challengeRemoved) {
                broadcastChallenges(io);
            }
            for (const [roomId, game] of activeGames.entries()) {
                if (game.white.id === socket.id || game.black.id === socket.id) {
                    const disconnectedColor = game.white.id === socket.id ? 'white' : 'black';
                    const timeoutKey = `${roomId}_${disconnectedColor}`;
                    const opponentSocket = disconnectedColor === 'white' ? game.black.socket : game.white.socket;

                    if (opponentSocket) {
                        opponentSocket.emit('opponent_disconnected', {
                            message: 'Opponent disconnected. waiting for 30s...',
                            timeout: RECONNECT_WINDOW
                        });
                    }

                    const timeout = setTimeout(() => {
                        if (activeGames.has(roomId) && disconnectTimeouts.has(timeoutKey)) {
                            const winner = disconnectedColor === 'white' ? 'black' : 'white';

                            io.to(roomId).emit('game_ended', {
                                result: winner,
                                reason: `${disconnectedColor} disconnected`
                            });

                            activeGames.delete(roomId);
                            disconnectTimeouts.delete(timeoutKey);
                            console.log(`Game ended due to disconnect timeout: ${roomId}`);
                        }
                    }, RECONNECT_WINDOW);

                    disconnectTimeouts.set(timeoutKey, timeout);
                    console.log(`Player disconnected from ${roomId}, waiting ${RECONNECT_WINDOW}ms for reconnect`);

                    break;
                }
            }
        });
    });
}
