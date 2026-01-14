export function getExpectedScore(playerRating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

export function calculateRatingChange(playerRating, opponentRating, result, k = 32) {
    const expected = getExpectedScore(playerRating, opponentRating);

    let score;
    switch (result) {
        case 'win':
            score = 1;
            break;
        case 'loss':
            score = 0;
            break;
        case 'draw':
            score = 0.5;
            break;
        default:
            score = 0.5;
    }

    return Math.round(k * (score - expected));
}

export function getRatingCategory(timeControl) {
    const [minutes, increment = 0] = timeControl.split('+').map(Number);
    const estimatedTime = minutes + (increment * 40 / 60);

    if (estimatedTime < 3) {
        return 'bullet';
    } else if (estimatedTime < 10) {
        return 'blitz';
    } else {
        return 'rapid';
    }
}

export function getKFactor(rating, gamesPlayed) {
    if (gamesPlayed < 30) {
        return 40;
    }
    if (rating >= 2400) {
        return 16;
    }
    return 32;
}

export function calculateGameRatings({
    whiteRating,
    blackRating,
    result,
    whiteGamesPlayed = 30,
    blackGamesPlayed = 30
}) {
    const whiteK = getKFactor(whiteRating, whiteGamesPlayed);
    const blackK = getKFactor(blackRating, blackGamesPlayed);

    let whiteResult, blackResult;
    switch (result) {
        case 'white':
            whiteResult = 'win';
            blackResult = 'loss';
            break;
        case 'black':
            whiteResult = 'loss';
            blackResult = 'win';
            break;
        default:
            whiteResult = 'draw';
            blackResult = 'draw';
    }

    const whiteChange = calculateRatingChange(whiteRating, blackRating, whiteResult, whiteK);
    const blackChange = calculateRatingChange(blackRating, whiteRating, blackResult, blackK);

    return {
        whiteChange,
        blackChange,
        whiteNewRating: Math.max(100, whiteRating + whiteChange),
        blackNewRating: Math.max(100, blackRating + blackChange)
    };
}
