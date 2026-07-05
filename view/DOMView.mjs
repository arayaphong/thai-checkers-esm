import { renderShell } from './templates/shell.mjs';
import { renderStatus } from './templates/status.mjs';
import { renderSetupCollapsed, renderSetupExpanded, MODES } from './templates/setup.mjs';
import { coordLabel, moveDot, rippleInner } from './templates/board.mjs';

// ============================================
// DOMView v6 — Proper State Management
//
// Architecture:
//   ViewState    = single source of UI truth
//   lastRender   = what was last drawn
//   diff()       = compute what changed
//   patch()      = apply minimal DOM updates
//   AnimationMgr = isolated animation lifecycle
// ============================================

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });

// ------------------------------------------------------------------
// DOMView
// ------------------------------------------------------------------
export class DOMView {
  #ctrl;
  #root;
  #squares = [];
  #view;
  #anim = null;
  #gameStarted = false;
  #setupEl;
  #statusEl;
  #gameAreaEl;
  #boardEl;
  #animLayer;

  constructor(controller, rootId) {
    const el = document.getElementById(rootId);
    if (!el) throw new Error(`#${rootId} not found in DOM`);
    this.#ctrl = controller;
    this.#root = el;
    this.#view = this.#buildViewState();
    this.#buildShell();
    this.#buildBoard();
    this.#bindEvents();
    this.#syncAll();
  }

  // ================================================================
  // Build ViewState from controller
  // ================================================================
  #buildViewState() {
    const s = this.#ctrl.state;
    return {
      phase: this.#computePhase(s),
      sel: this.#ctrl.selectedPiece,
      isAIThinking: false,
      gameConfig: { ...s.config },
      boardState: this.#hashBoard(s.board),
      statusText: s.status,
      pieceCounts: { ...s.pieceCounts },
    };
  }

  #computePhase(s) {
    if (s.status !== 'playing') return 'gameover';
    if (this.#anim) return 'animating';
    if (this.#gameStarted) return 'playing';
    return 'setup';
  }

  #hashBoard(board) {
    return board.flat().reduce((acc, cell) => acc * 31 + cell + 16, 0);
  }

  // ================================================================
  // SHELL + BOARD (one-time build)
  // ================================================================
  #buildShell() {
    this.#root.innerHTML = '';
    this.#root.className = 'min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 font-sans text-gray-100';
    this.#root.innerHTML = renderShell();
    this.#setupEl = this.#root.querySelector('#setupPanel');
    this.#statusEl = this.#root.querySelector('#statusPanel');
    this.#gameAreaEl = this.#root.querySelector('#gameArea');
    this.#boardEl = this.#root.querySelector('#board');
    this.#animLayer = h('div', 'absolute z-30 pointer-events-none');
    this.#animLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    this.#boardEl.append(this.#animLayer);
  }

  #buildBoard() {
    this.#squares = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let c = 0; c < 8; c++) {
        const isDark = (r + c) % 2 === 1;
        const el = h('div', `w-full h-full flex items-center justify-center relative ${isDark ? 'bg-slate-700 hover:bg-slate-600 cursor-pointer' : 'bg-stone-800/60'}`);
        el.addEventListener('click', () => this.#onClick({ r, c }));
        if (c === 0) el.insertAdjacentHTML('beforeend', coordLabel(8 - r, isDark));
        if (r === 7) el.insertAdjacentHTML('beforeend', coordLabel(String.fromCharCode(65 + c), isDark));
        this.#boardEl.insertBefore(el, this.#animLayer);
        row.push({ el, piece: 0, hasDot: false, selected: false, mustMove: false, hasHint: false });
      }
      this.#squares.push(row);
    }
  }

  // ================================================================
  // EVENTS — map to state changes
  // ================================================================
  #bindEvents() {
    this.#ctrl.on('stateChanged', () => this.#onStateChanged());
    this.#ctrl.on('pieceSelected', () => this.#onPieceSelected());
    this.#ctrl.on('moveMade', (evt) => this.#onMoveMade(evt));
    this.#ctrl.on('aiThinking', () => { this.#view.isAIThinking = true; this.#syncStatus(); });
    this.#ctrl.on('aiMoved', () => { this.#view.isAIThinking = false; this.#syncStatus(); });
    this.#ctrl.on('gameOver', () => { this.#killAnim(); this.#view.phase = 'gameover'; this.#syncAll(); });
    this.#ctrl.on('multiCapture', () => { this.#view.sel = this.#ctrl.selectedPiece; this.#syncBoard(); this.#syncStatus(); });
  }

  // ================================================================
  // EVENT HANDLERS — update view state, then sync
  // ================================================================
  #onStateChanged() {
    const s = this.#ctrl.state;
    this.#view.phase = this.#computePhase(s);
    this.#view.gameConfig = { ...s.config };
    this.#view.statusText = s.status;
    this.#view.pieceCounts = { ...s.pieceCounts };
    if (!this.#anim) {
      this.#view.boardState = this.#hashBoard(s.board);
      this.#view.sel = this.#ctrl.selectedPiece;
    }
    this.#syncAll();
  }

  #onPieceSelected() {
    this.#view.sel = this.#ctrl.selectedPiece;
    this.#syncBoard();
  }

  #onMoveMade(evt) {
    const move = evt.data?.move;
    if (!move) return;

    this.#view.sel = this.#ctrl.selectedPiece;
    this.#view.phase = 'animating';

    const piece = this.#ctrl.state.board[move.toR][move.toC];
    const victimPos = move.isCapture && move.jumpedR !== undefined
      ? { r: move.jumpedR, c: move.jumpedC }
      : null;

    this.#killAnim();
    this.#view.boardState = this.#hashBoard(this.#ctrl.state.board);
    this.#syncBoard();
    this.#clearDots();

    // 3. Remove source piece, add ripple
    const src = this.#squares[move.fromR][move.fromC];
    src.el.querySelector('.piece')?.remove();
    src.piece = 0;
    const ripple = h('div', 'abs-fill flex-center z-10 pointer-events-none');
    ripple.innerHTML = rippleInner;
    src.el.append(ripple);
    setTimeout(() => ripple.remove(), 350);

    // 4. Show victim (for capture)
    let victimEl = null;
    if (victimPos) {
      const vSq = this.#squares[victimPos.r][victimPos.c];
      vSq.el.querySelector('.piece')?.remove();
      vSq.piece = 0;
      const vPiece = Math.sign(piece) > 0 ? -1 : 1;
      victimEl = this.#makePiece(Math.abs(vPiece), Math.sign(vPiece));
      victimEl.classList.add('absolute', 'z-[15]');
      vSq.el.append(victimEl);
    }

    // 5. Remove dest piece (covered by anim overlay)
    const dst = this.#squares[move.toR][move.toC];
    dst.el.querySelector('.piece')?.remove();
    dst.piece = 0;

    // 6. Create slide overlay
    const P = 12.5;
    const slide = this.#makePiece(Math.abs(piece), Math.sign(piece));
    slide.classList.add('absolute', 'pointer-events-none');
    slide.style.cssText = `position:absolute;width:${P}%;height:${P}%;top:${move.fromR * P}%;left:${move.fromC * P}%;padding:2.5%;z-index:30;transition:top 280ms ease-out,left 280ms ease-out;`;
    this.#animLayer.append(slide);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      slide.style.top = `${move.toR * P}%`;
      slide.style.left = `${move.toC * P}%`;
    }));

    // 7. Store anim state
    const timer = setTimeout(() => {
      this.#animLayer.innerHTML = '';

      if (victimEl) {
        victimEl.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out';
        victimEl.style.opacity = '0';
        victimEl.style.transform = 'scale(0.3)';
        setTimeout(() => victimEl?.remove(), 160);
      }

      this.#syncBoard();
      const destPiece = this.#squares[move.toR][move.toC].el.querySelector('.piece');
      if (destPiece) {
        destPiece.classList.add('animate-land');
        setTimeout(() => destPiece.classList.remove('animate-land'), 250);
      }

      this.#anim = null;
      this.#view.phase = this.#computePhase(this.#ctrl.state);
    }, 280);

    this.#anim = { from: { r: move.fromR, c: move.fromC }, to: { r: move.toR, c: move.toC }, piece, victim: victimPos, timer };
    this.#syncStatus();
  }

  // ================================================================
  // SYNC — minimal DOM updates based on state diff
  // ================================================================
  #syncAll() {
    this.#syncSetup();
    this.#syncStatus();
    this.#syncBoard();
  }

  #syncBoard() {
    const s = this.#ctrl.state;
    const { board, mustMovePiece } = s;
    const selMoves = this.#view.sel
      ? s.validMoves.filter(m => m.fromR === this.#view.sel.r && m.fromC === this.#view.sel.c)
      : [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = this.#squares[r][c];
        const piece = board[r][c];
        const isSel = this.#view.sel?.r === r && this.#view.sel?.c === c;
        const dotMove = selMoves.find(m => m.toR === r && m.toC === c);
        const isMust = mustMovePiece?.r === r && mustMovePiece?.c === c;
        const hasMove = s.validMoves.some(m => m.fromR === r && m.fromC === c);

        if (sq.piece !== piece || sq.selected !== isSel || sq.mustMove !== (isMust && !isSel) || sq.hasHint !== (hasMove && !isSel && !mustMovePiece)) {
          sq.el.querySelector('.piece')?.remove();
          if (piece !== 0) {
            const p = this.#makePiece(Math.abs(piece), Math.sign(piece), isSel, isMust && !isSel, hasMove && !isSel && !mustMovePiece);
            sq.el.append(p);
          }
          sq.piece = piece;
          sq.selected = isSel;
          sq.mustMove = isMust && !isSel;
          sq.hasHint = hasMove && !isSel && !mustMovePiece;
        }

        const shouldDot = dotMove ? (dotMove.isCapture ? 'capture' : 'walk') : 'none';
        const hasDotNow = sq.hasDot ? (sq.el.querySelector('.dot-capture') ? 'capture' : 'walk') : 'none';
        if (shouldDot !== hasDotNow) {
          sq.el.querySelector('.dot')?.remove();
          sq.hasDot = false;
          if (shouldDot !== 'none') {
            const color = shouldDot === 'capture' ? 'bg-rose-400 dot-capture' : 'bg-emerald-300';
            sq.el.insertAdjacentHTML('beforeend', moveDot(color));
            sq.hasDot = true;
          }
        }
      }
    }
  }

  #syncStatus() {
    const s = this.#ctrl.state;
    const { turn, status, mustMovePiece } = s;
    this.#statusEl.innerHTML = renderStatus({
      turn,
      status,
      mustMovePiece,
      cfg: this.#view.gameConfig,
      pieceCounts: this.#view.pieceCounts,
      isAIThinking: this.#view.isAIThinking,
    });
    this.#statusEl.querySelector('#resetBtn')?.addEventListener('click', () => {
      this.#gameStarted = false;
      this.#view.phase = 'setup';
      this.#gameAreaEl.classList.add('opacity-30', 'pointer-events-none');
      this.#killAnim();
      this.#ctrl.reset();
    });
  }

  #syncSetup() {
    const cfg = this.#view.gameConfig;
    if (this.#gameStarted && this.#view.phase !== 'setup') {
      this.#setupEl.innerHTML = renderSetupCollapsed(cfg);
      this.#setupEl.querySelector('button').onclick = () => {
        this.#gameStarted = false;
        this.#view.phase = 'setup';
        this.#gameAreaEl.classList.add('opacity-30', 'pointer-events-none');
        this.#syncAll();
      };
      return;
    }

    this.#setupEl.innerHTML = renderSetupExpanded(cfg);

    this.#setupEl.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      const m = MODES.find(x => x.k === b.dataset.mode);
      this.#ctrl.updateConfig({ whiteIsAI: m.w, blackIsAI: m.b });
    });
    this.#setupEl.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => this.#ctrl.updateConfig({ aiDifficulty: b.dataset.diff }));
    this.#setupEl.querySelector('#startBtn')?.addEventListener('click', () => {
      this.#gameStarted = true;
      this.#view.phase = 'playing';
      this.#gameAreaEl.classList.remove('opacity-30', 'pointer-events-none');
      this.#ctrl.reset();
    });
  }

  // ================================================================
  // HELPERS
  // ================================================================
  #makePiece(val, sign, selected = false, must = false, hint = false) {
    const div = h('div', `piece w-[80%] h-[80%] rounded-full shadow-lg flex items-center justify-center relative z-10 transition-transform duration-200 hover:scale-105 ${
      sign === 1 ? 'bg-gradient-to-b from-white via-stone-200 to-stone-400 border-2 border-stone-300 shadow-stone-500/30' : 'bg-gradient-to-b from-neutral-600 to-neutral-900 border-2 border-neutral-950 shadow-black/40'
    } ${selected ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-slate-900' : ''} ${must ? 'ring-4 ring-rose-500 ring-offset-2 ring-offset-slate-700 animate-piece-pulse' : ''} ${hint ? 'ring-2 ring-amber-400' : ''}`);
    const inner = h('div', `w-[70%] h-[70%] rounded-full border flex items-center justify-center ${sign === 1 ? 'border-stone-400/40' : 'border-neutral-600/40'}`);
    if (val === 2) {
      inner.innerHTML = `<svg class="w-3/5 h-3/5 ${sign === 1 ? 'text-amber-600' : 'text-amber-400'}"><use href="#icon-crown"/></svg>`;
    }
    div.append(inner);
    return div;
  }

  #clearDots() {
    this.#squares.flat().forEach(sq => {
      sq.el.querySelector('.dot')?.remove();
      sq.hasDot = false;
    });
  }

  #killAnim() {
    if (this.#anim) {
      clearTimeout(this.#anim.timer);
      this.#anim = null;
    }
    this.#animLayer.innerHTML = '';
  }

  #onClick(pos) {
    if (!this.#gameStarted || this.#view.isAIThinking) return;
    this.#ctrl.attemptMove(pos);
  }
}



