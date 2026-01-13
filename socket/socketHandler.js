const openChallenges = new Map();
const activeGames = new Map();
const disconnectTimeouts = new Map();
const RECONNECT_WINDOW = 30000;

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
                        timeControl
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
            const challengeId = `challenge_${socket.id}_${Date.now()}`;
            const challenge = {
                id: challengeId,
                playerId: socket.id,
                username: data.username || 'Guest',
                rating: data.rating || 1200,
                timeControl: data.timeControl || '10+0',
                createdAt: Date.now()
            };

            openChallenges.set(challengeId, challenge);


            socket.emit('challenge_created', { challengeId, challenge });

            broadcastChallenges(io);
        });

        socket.on('accept_challenge', ({ challengeId }) => {
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

            const isAcceptorWhite = Math.random() < 0.5;
            const white = isAcceptorWhite
                ? { socket, id: socket.id, username: 'Guest', rating: 1200 }
                : { socket: challengerSocket, id: challenge.playerId, username: challenge.username, rating: challenge.rating };
            const black = isAcceptorWhite
                ? { socket: challengerSocket, id: challenge.playerId, username: challenge.username, rating: challenge.rating }
                : { socket, id: socket.id, username: 'Guest', rating: 1200 };

            white.socket.join(roomId);
            black.socket.join(roomId);

            activeGames.set(roomId, {
                white: { id: white.id, username: white.username, rating: white.rating },
                black: { id: black.id, username: black.username, rating: black.rating },
                moves: [],
                startTime: Date.now(),
                lastMoveTime: Date.now(),
                whiteTime: parseInt(challenge.timeControl.split('+')[0]) * 60,
                blackTime: parseInt(challenge.timeControl.split('+')[0]) * 60,
                currentTurn: 'white',
                timeControl: challenge.timeControl
            });

            white.socket.emit('game_start', {
                roomId,
                color: 'white',
                opponent: { username: black.username, rating: black.rating },
                timeControl: challenge.timeControl
            });

            black.socket.emit('game_start', {
                roomId,
                color: 'black',
                opponent: { username: white.username, rating: white.rating },
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

            socket.to(roomId).emit('opponent_move', { move, fen, from, to });


        });

        socket.on('game_over', ({ roomId, result, reason }) => {
            const game = activeGames.get(roomId);
            if (!game) return;
            io.to(roomId).emit('game_ended', { result, reason });
            activeGames.delete(roomId);

        });

        socket.on('resign', ({ roomId }) => {
            const game = activeGames.get(roomId);
            if (!game) return;

            const playerColor = game.white.id === socket.id ? 'white' : 'black';
            const winner = playerColor === 'white' ? 'black' : 'white';

            io.to(roomId).emit('game_ended', {
                result: winner,
                reason: `${playerColor} resigned`
            });

            activeGames.delete(roomId);

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
                timeControl: game.timeControl,
                currentTurn: game.currentTurn
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
