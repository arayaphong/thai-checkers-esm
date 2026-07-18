const DEFAULT_HARD_PRUNE = Object.freeze({
    minVisits: 30,
    minLosses: 27,
    minLossRate: 0.9,
});

export const normalizedTrajectoryPositionKey = (positionKey) => {
    if (typeof positionKey === 'bigint') return positionKey.toString();
    if (typeof positionKey === 'string' && /^(0|[1-9]\d*)$/.test(positionKey)) {
        return positionKey;
    }
    throw new TypeError('positionKey must be a non-negative bigint or decimal string');
};

export const trajectoryMoveKey = (move) =>
    `${move.from.hash()}:${move.to.hash()}:${move.captured
        .map((position) => position.hash())
        .toSorted((left, right) => left - right)}`;

export const trajectoryEdgeKey = (positionKey, moveKey) => {
    if (typeof moveKey !== 'string' || moveKey.length === 0) {
        throw new TypeError('moveKey must be a non-empty string');
    }
    return `${normalizedTrajectoryPositionKey(positionKey)}:${moveKey}`;
};

/** Returns a bounded score in the side-to-move perspective encoded by positionKey. */
export const trajectoryBias = (trajectory, positionKey) => {
    const stats = trajectory.states[normalizedTrajectoryPositionKey(positionKey)];
    if (stats === undefined) return 0;
    const mean = stats.valueSum / (stats.visits + trajectory.config.priorVisits);
    const bias = mean * trajectory.config.maxBias;
    return Math.max(-trajectory.config.maxBias, Math.min(trajectory.config.maxBias, bias));
};

const edgeQuality = (stats) => ({
    lossRate: stats.losses / stats.visits,
    expectedOutcome: (stats.wins - stats.losses) / stats.visits,
});

/**
 * Returns move indices whose learned edge outcomes meet the hard-prune policy.
 * At least one move always survives.
 */
export const hardPruneMoveIndices = (
    trajectory,
    positionKey,
    moves,
    moveKeyForMove = trajectoryMoveKey,
) => {
    if (!Array.isArray(moves)) throw new TypeError('moves must be an array');
    if (typeof moveKeyForMove !== 'function') {
        throw new TypeError('moveKeyForMove must be a function');
    }
    if (moves.length <= 1) return new Set();

    const stateKey = normalizedTrajectoryPositionKey(positionKey);
    const statsByIndex = moves.map(
        (move) => trajectory.edges[trajectoryEdgeKey(stateKey, moveKeyForMove(move))],
    );
    const { minVisits, minLosses, minLossRate } =
        trajectory.config.hardPrune ?? DEFAULT_HARD_PRUNE;
    const pruned = new Set();

    statsByIndex.forEach((stats, index) => {
        if (
            stats !== undefined &&
            stats.visits >= minVisits &&
            stats.losses >= minLosses &&
            stats.losses / stats.visits >= minLossRate
        ) {
            pruned.add(index);
        }
    });

    if (pruned.size === moves.length) {
        const bestIndex = statsByIndex.reduce((best, stats, index) => {
            const quality = edgeQuality(stats);
            const bestQuality = edgeQuality(statsByIndex[best]);
            if (quality.lossRate !== bestQuality.lossRate) {
                return quality.lossRate < bestQuality.lossRate ? index : best;
            }
            if (quality.expectedOutcome !== bestQuality.expectedOutcome) {
                return quality.expectedOutcome > bestQuality.expectedOutcome ? index : best;
            }
            return stats.visits > statsByIndex[best].visits ? index : best;
        }, 0);
        pruned.delete(bestIndex);
    }

    return pruned;
};
