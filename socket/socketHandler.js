const waitingPlayers = [];
const openChallenges = new Map();
const activeGames = new Map();

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
                    socket.emit('error', { message: 'Challenge no longer available' });
                    broadcastChallenges(io);
                    socket.emit('waiting_for_opponent');
                    return;
                }

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

            const newPlayer = {
                id: socket.id,
                socket: socket,
                username,
                rating,
                timeControl
            };

            waitingPlayers.push(newPlayer);

            const matchIndex = waitingPlayers.findIndex((p, idx) =>
                idx !== waitingPlayers.length - 1 &&
                p.timeControl === newPlayer.timeControl
            );

            if (matchIndex !== -1) {
                const opponent = waitingPlayers.splice(matchIndex, 1)[0];
                const currentPlayer = waitingPlayers.pop();

                const roomId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const [white, black] = Math.random() < 0.5
                    ? [currentPlayer, opponent]
                    : [opponent, currentPlayer];
                white.socket.join(roomId);
                black.socket.join(roomId);

                const timeControl = white.timeControl;

                activeGames.set(roomId, {
                    white: { id: white.id, username: white.username, rating: white.rating },
                    black: { id: black.id, username: black.username, rating: black.rating },
                    moves: [],
                    startTime: Date.now(),
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


            } else {
                socket.emit('waiting_for_opponent');
            }
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

        socket.on('disconnect', () => {


            const waitingIndex = waitingPlayers.findIndex(p => p.id === socket.id);
            if (waitingIndex !== -1) {
                waitingPlayers.splice(waitingIndex, 1);

            }

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
                    const winner = disconnectedColor === 'white' ? 'black' : 'white';

                    socket.to(roomId).emit('game_ended', {
                        result: winner,
                        reason: `${disconnectedColor} disconnected`
                    });

                    activeGames.delete(roomId);

                    break;
                }
            }
        });
    });
}
