# WS AI Engine Protocol — Vendor Spec

This is the implementation-independent contract for a WebSocket-hosted Thai
Checkers AI engine. It exists so a third party can build a **compatible
engine in any language**, from this document alone, without reading this
repo's source. (For notes on *this repo's own* implementation, see
[ws-engine.md](./ws-engine.md).)

## Transport & envelope

Plain WebSocket (RFC 6455). One JSON object per text frame, one frame per
message — no batching, no binary frames.

**Request**

```json
{ "id": "1", "type": "playAiMove", "session": { "...": "see below" }, "depth": 6 }
```

**Success response**

```json
{ "id": "1", "result": { "played": true, "matchIndex": 2, "moveKey": "4:8:", "score": 0, "nodes": 1216, "elapsedMs": 75.3 } }
```

When no legal move exists, omit every `result` field except `played`:

```json
{ "id": "1", "result": { "played": false } }
```

**Failure response**

```json
{ "id": "1", "error": "some human-readable message" }
```

Rules:

- `id` in the response **must echo the request's `id` verbatim** — it's how the caller matches responses to in-flight requests (a client may have more than one outstanding).
- A frame that fails to parse as JSON has no `id` to reply to — drop it silently rather than answering.
- `type` is always `"playAiMove"` today; a server that receives an unrecognized `type` should reply with an `error`, not silently ignore the request.

## Statelessness contract

Every request is **self-contained**. The server MUST derive its answer
purely from that single request's `(session, depth)` — no memory of earlier
requests, on this connection or any other. A compliant server does not need
an init/handshake/session step of any kind.

This is deliberate: it's what makes an engine freely restartable and
replaceable. A client can open one connection and send many requests over
its lifetime, or open a fresh connection per request — both must work
identically, since the server keeps no state either way.

## `session` shape

`session` is exactly the JSON produced by this repo's `GameDriver#toJSON()`.
Worked example — a fresh game, no moves played yet:

```json
{
  "format": "thai-checkers-cli-session-v1",
  "initialSetup": { "board": "18374687579166474240", "sideToMove": "WHITE" },
  "moveSequence": [],
  "currentIndex": 0
}
```

- `format` — a literal version tag for this session shape. `"thai-checkers-cli-session-v1"` is the only value defined today.
- `initialSetup.board` — a decimal-string-encoded bitboard for the starting position of this session (not necessarily the game's true starting position — a session can begin from any legal setup). Standard 8×8 international-style board, 32 playable dark squares.
- `initialSetup.sideToMove` — `"WHITE"` or `"BLACK"`, whoever moves first from `initialSetup.board`.
- `moveSequence` — an array of moves already played from `initialSetup`, in order. Each entry: `{ "index": 0, "from": "D2", "to": "C3", "captured": [], "path": ["D2", "C3"] }` — squares in algebraic notation (`A1`..`H8`, columns A-H left to right, rows 1-8 bottom to top from White's side). `captured` lists the squares of pieces removed during that move (empty for a non-capturing move); `path` lists every square touched, start to end (more than two entries for a multi-jump chain capture).
- `currentIndex` — how far into `moveSequence` play has progressed (usually `moveSequence.length`, but can be less if the session recorded now-undone moves).

To analyze `session`, a server needs to: decode `initialSetup.board` into a board position, replay `moveSequence[0..currentIndex)` onto it, and enumerate legal moves for the side to move at that point — using rules identical to this repo's `core/` (standard captures-mandatory international-draughts-style rules on an 8×8 board, per the project's README).

## The critical compatibility constraint

This is the part most likely to trip up an independent implementation.

`matchIndex` is not an arbitrary move descriptor — it is **an index into the
reference engine's own ordered legal-move list** for the analyzed position.
`moveKey` is a canonical identity string for that same move:

```
moveKey = `${fromSquareHash}:${toSquareHash}:${sortedCapturedSquareHashes.join(',')}`
```

where a square's *hash* is its 0..31 index in the 32-playable-square board
numbering (row-major from the same corner `initialSetup.board` is encoded
from) — **not** its algebraic string. Worked examples:

| Position | Move | `matchIndex` | `moveKey` |
| --- | --- | --- | --- |
| Fresh game (session above) | `B2 -> C3` | `1` | `"4:8:"` |
| Mid-game, White to move, forced chain capture available | `F4 -> D6 -> F8` capturing `E5`, `E7` | (position-dependent) | `"14:30:18,26"` |

The caller — never the engine — is the source of truth for what counts as a
legal move: it independently re-derives its own legal-move list from the
same `session` using the reference rules engine, looks up `matchIndex` in
*that* list, and only accepts the response if the indexed move's `moveKey`
matches the one returned. **This means a compliant engine must enumerate
legal moves in exactly the same order the reference engine does** — not just
compute any semantically-equivalent legal-move set. A different (even
fully correct) ordering will make every response get silently rejected as
invalid, not accepted-but-wrong: an engine that returns a bad `matchIndex`
or a mismatched `moveKey` simply never gets its move applied.

In practice, the reliable way to satisfy this is to **depend on this repo's
`cli/GameDriver.mjs` + `core/`** for session decoding, replay, and move
enumeration, and plug in your own logic only for *which* legal move to pick
given `depth`. This is exactly what the reference server
(`server/gameDriverServer.mjs`) does — it is not a simplification of the
spec, it is the practical spec.

## `depth`

Integer, `1..16` today (`MAX_ANALYSIS_DEPTH` in `core/Analyzer.mjs`). This
is the reference engine's own search-depth limit, not a wire-protocol limit
— a vendor engine may interpret `depth` under its own search semantics
however it likes, as long as a larger value means "search more."

## Timing

- The wire protocol itself defines **no response deadline** — a deep search can legitimately take seconds, and the server should take as long as it needs to answer correctly.
- This repo's reference client (`controller/WsGameDriver.mjs`) does enforce two client-side timeouts of its own, for robustness, not because the protocol requires them: a short one (400ms) on the initial connection handshake, and a longer one (60s, overridable) on waiting for a response to an in-flight request — a server that never answers is otherwise indistinguishable from one still thinking. A vendor engine has no way to know these values are enforced and doesn't need to match them, but should aim to respond in a bounded, predictable time regardless, since a human is waiting on the other end for their turn.

## Non-goals (stated explicitly, not left implicit)

- **No authentication, no encryption.** Anyone who can open a TCP connection to the port can request analysis.
- **No session/room/matchmaking concept.** This is not a multiplayer protocol — see the statelessness contract above.
- **No move-legality contract beyond the index/key check.** An engine that returns a bogus `matchIndex` doesn't corrupt anything; its move is simply never applied, and the caller's turn ends up unresolved (surfaced as an error on the caller's side, not a protocol-level rejection message from the server).

A vendor deploying an engine beyond `localhost` is responsible for their own
transport security and access control — the protocol has none built in.

## Conformance checking

Run `node examples/checkWsEngineConformance.mjs <ws-url>` against your own
server to self-certify compatibility without needing to read this repo's
internals or its test suite. It sends the two worked-example sessions above
(and a couple of others) at a few depths and checks that every response is
well-formed and points at a real, `moveKey`-matching legal move — the exact
thing described in "The critical compatibility constraint" above.
