# WS AI Engine Protocol — Specification

This document specifies a WebSocket protocol for requesting a move from an
AI engine for an international-draughts-style game (mandatory captures,
chain captures, flying kings) played on a standard 8×8 board with 32
playable dark squares. It is self-contained: an implementer needs nothing
beyond this document to build a compliant engine, in any language, and no
existing engine or client is required as a reference.

A compliant engine's job is narrow and well-defined: given a position and
the full list of legal moves available in that position, choose one and
report which one. The engine never needs to derive board encoding, generate
legal moves itself, or match any other implementation's internal move
ordering — the caller always supplies the complete candidate list, and the
engine answers purely by selecting an entry from it.

## Transport & envelope

Plain WebSocket (RFC 6455). One JSON object per text frame, one frame per
message — no batching, no binary frames.

**Request**

```json
{
  "id": "1",
  "type": "playAiMove",
  "position": {
    "pieces": [
      ["F4", { "color": "WHITE", "type": "PION" }],
      ["G5", { "color": "BLACK", "type": "PION" }],
      ["E5", { "color": "BLACK", "type": "PION" }]
    ],
    "sideToMove": "WHITE"
  },
  "legalMoves": [
    { "from": "F4", "to": "H6", "captured": ["G5"], "path": ["F4", "H6"] },
    { "from": "F4", "to": "D6", "captured": ["E5"], "path": ["F4", "D6"] }
  ],
  "depth": 6
}
```

**Success response**

```json
{ "id": "1", "result": { "played": true, "matchIndex": 0, "score": 12, "nodes": 340, "elapsedMs": 45.2 } }
```

When `legalMoves` is empty, there is nothing to choose — respond with
`played: false` and no other fields:

```json
{ "id": "1", "result": { "played": false } }
```

**Failure response**

```json
{ "id": "1", "error": "some human-readable message" }
```

### Field rules

- `id` in the response **must echo the request's `id` verbatim** — it's how a caller matches responses to in-flight requests (there may be more than one outstanding on a connection at once).
- A frame that fails to parse as JSON has no `id` to reply to — drop it silently rather than answering.
- `type` is always `"playAiMove"` today; on an unrecognized `type`, reply with an `error` rather than ignoring the request.
- `matchIndex` is a zero-based index into the **request's own `legalMoves` array**. It is the only thing identifying which move was chosen — there is no separate move-identity field to compute or match. A response with `matchIndex` outside `[0, legalMoves.length)` is invalid; a caller should treat it as equivalent to a failure response.
- `score`, `nodes`, and `elapsedMs` are optional numeric diagnostics (evaluation score in the engine's own units, node/position count explored, wall-clock milliseconds spent). A minimal engine may omit them or report `0`; they carry no protocol meaning beyond information for the caller to display or log.

## Board and move notation

- Squares are written in algebraic notation: a file letter `A`–`H` (left to right) followed by a rank digit `1`–`8` (bottom to top from White's perspective). Only dark squares are playable — the 32 squares where file-index + rank-index is even when both are counted from 0 (`A1`, `A3`, `A5`, `A7`, `B2`, `B4`, ... and so on); the other 32 squares are never referenced.
- A piece is `{ "color": "WHITE" | "BLACK", "type": "PION" | "DAME" }`. `PION` is a regular piece; `DAME` is a promoted "king" piece.
- `position.pieces` is the complete board state as an array of `[square, piece]` pairs — every occupied square, in any order. Squares not listed are empty.
- `position.sideToMove` (`"WHITE"` or `"BLACK"`) says whose legal moves `legalMoves` enumerates.
- A move is `{ from, to, captured, path }`:
  - `from` / `to` — the moving piece's starting and final squares.
  - `captured` — the squares of every opposing piece removed by this move (empty array for a non-capturing move).
  - `path` — every square touched, in order, from `from` to `to` inclusive. For a simple move this is `[from, to]`; for a multi-jump chain capture it has one entry per landing square along the way.

Implementers do not need to re-derive `legalMoves` — it is always supplied,
complete and authoritative, for the position in the same request. Deriving
it independently is neither required nor necessary for protocol compliance.
An engine that wants to look further ahead than the immediate position (to
evaluate resulting positions after a candidate move, for a deeper search)
is responsible for its own game-rule and move-generation logic beyond what
this protocol supplies — the general shape of the rules is: pieces capture
by jumping a single adjacent opposing piece into an empty square beyond it;
capturing is mandatory whenever available and a capture that can continue
jumping with the same piece must continue as part of the same move; a
`PION` reaching the farthest rank from its own side promotes to `DAME`; a
`DAME` may move or capture any distance along a clear diagonal in any of
the four directions. This protocol does not attempt to be an exhaustive
rules reference — it defines the wire format for requesting and reporting a
move choice, not the rules of the game itself.

## Statelessness contract

Every request is **self-contained**. A server MUST derive its answer purely
from that single request's `(position, legalMoves, depth)` — no memory of
earlier requests, on this connection or any other. A compliant server does
not need an init/handshake/session step of any kind.

This is deliberate: it's what makes an engine implementation freely
restartable and replaceable, and it means a caller may open one connection
and send many requests over its lifetime, or open a fresh connection per
request — both must work identically, since the server keeps no state
either way.

## `depth`

A positive integer hint for how much effort to spend searching — larger
means "search more thoroughly." This protocol defines no fixed range or
required interpretation: an engine may treat it as a ply count for a
minimax-style search, as one of several difficulty tiers, or ignore it
entirely and always respond at a single fixed strength. An engine with its
own maximum should clamp internally rather than error on a large value.

## Timing

This protocol defines no fixed response deadline — thorough search can
legitimately take longer for larger `depth` values. A server should still
respond in a bounded, predictable time appropriate to the effort implied by
`depth`, since a caller is typically waiting synchronously for the reply
before a human's turn can proceed. Callers may enforce their own timeouts;
an engine that will not respond promptly at high `depth` values should
document its own expected response times.

## Non-goals (stated explicitly, not left implicit)

- **No authentication, no encryption.** Anyone who can open a connection to the port can request a move.
- **No session, room, or matchmaking concept.** This is a single-request-in, single-response-out protocol — see the statelessness contract above. It is not a multiplayer protocol.
- **No legality contract beyond the index selection.** A response with an out-of-range `matchIndex` is simply invalid and should be treated as a failure by the caller; the protocol does not define recovery or retry behavior beyond that.

A server deployed anywhere beyond a trusted local connection is responsible
for its own transport security and access control — this protocol has none
built in.
