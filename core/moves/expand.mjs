// Shared route geometry. A move stores only its waypoints — `from` plus each
// landing square — so consecutive entries can sit several diagonal cells apart
// (the captured piece for a pion, plus any empty squares a dame glides over).
// `expandRoute` fills those gaps in so every consecutive pair is adjacent,
// giving a continuous trail to print or highlight from source to destination.

import { Position } from '../Position.mjs';

/**
 * Fills in the cell gaps in the path representation.
 * @param {import('../Position.mjs').Position[]} waypoints
 * @returns {import('../Position.mjs').Position[]}
 */
export const expandRoute = (waypoints) =>
    waypoints.length === 0
        ? []
        : [
              waypoints[0],
              ...waypoints.slice(0, -1).flatMap((from, i) => {
                  const to = waypoints[i + 1];
                  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
                  const stepX = Math.sign(to.x - from.x);
                  const stepY = Math.sign(to.y - from.y);
                  return Array.from({ length: steps }, (_, s) =>
                      Position.fromCoords(from.x + stepX * (s + 1), from.y + stepY * (s + 1)),
                  );
              }),
          ];

/**
 * The continuous trail from `from` to `to`, but only when it is unambiguous:
 * exactly one legal move connects the two squares. Returns `null` when there is
 * no such move or when several distinct moves share the same endpoints (e.g.
 * dame loops that capture different piece sets) — those are intentionally not
 * highlighted.
 * @param {import('../Game.mjs').Move[]} moves
 * @param {string} from algebraic notation, e.g. "D1"
 * @param {string} to algebraic notation, e.g. "B3"
 * @returns {import('../Position.mjs').Position[] | null}
 */
export const singleRoute = (moves, from, to) => {
    const matches = moves.filter(
        (move) => move.from.toString() === from && move.to.toString() === to,
    );
    return matches.length === 1 ? expandRoute(matches[0].path) : null;
};
