export const renderStatus = ({ turn, status, mustMovePiece, cfg, pieceCounts, isAIThinking }) => {
  const WINNER_TEXT = {
    white_wins: '🎉 ฝ่ายขาวชนะ! 🎉',
    black_wins: '🎉 ฝ่ายดำชนะ! 🎉',
    draw: 'เสมอ!',
  };
  const over = status !== 'playing';
  const winner = WINNER_TEXT[status] ?? WINNER_TEXT.draw;

  return `
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${turn === 1 && !over ? 'bg-stone-50 border-emerald-500' : 'bg-neutral-800 border-neutral-700 opacity-60'}">
          <span class="text-lg">⚪</span>
          <div class="text-xs leading-tight">
            <div class="font-bold ${turn === 1 ? 'text-neutral-800' : 'text-gray-400'}">ขาว</div>
            <div class="text-neutral-500">${cfg.whiteIsAI ? '🤖 AI' : '👤 คน'}</div>
          </div>
        </div>
        <span class="text-neutral-600 font-bold text-lg">vs</span>
        <div class="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${turn === -1 && !over ? 'bg-neutral-700 border-emerald-500' : 'bg-neutral-800 border-neutral-700 opacity-60'}">
          <span class="text-lg">⚫</span>
          <div class="text-xs leading-tight">
            <div class="font-bold ${turn === -1 ? 'text-gray-100' : 'text-gray-400'}">ดำ</div>
            <div class="text-neutral-500">${cfg.blackIsAI ? '🤖 AI' : '👤 คน'}</div>
          </div>
        </div>
      </div>
      <div class="flex gap-3 text-xs text-neutral-400">
        <div class="text-center">
          <div class="font-bold text-stone-300 text-sm">${pieceCounts.white.total}</div>
          <div>⚪ หมาก</div>
        </div>
        <div class="text-neutral-600">|</div>
        <div class="text-center">
          <div class="font-bold text-neutral-300 text-sm">${pieceCounts.black.total}</div>
          <div>⚫ หมาก</div>
        </div>
      </div>
      <button id="resetBtn" class="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-gray-200 px-4 py-2 rounded-lg font-semibold transition-colors border border-neutral-700">
        <svg class="w-4 h-4 inline"><use href="#icon-restart"/></svg> เริ่มใหม่
      </button>
    </div>
    <div class="text-center bg-neutral-800 rounded-xl p-3 border border-neutral-700">
      ${over
        ? `<span class="text-lg font-bold text-emerald-400">${winner}</span>`
        : `${isAIThinking
            ? `<span class="text-emerald-400 animate-pulse flex items-center justify-center gap-2"><svg class="w-4 h-4 inline"><use href="#icon-bot"/></svg> AI กำลังคิด...</span>`
            : `ตาของ: <span class="${turn === 1 ? 'text-stone-100' : 'text-gray-300'} ml-2 font-bold">${turn === 1 ? '⚪ ขาว' : '⚫ ดำ'}</span>`
          }${mustMovePiece && !isAIThinking
            ? `<br/><span class="text-sm font-bold text-rose-400 animate-pulse bg-rose-900/30 px-3 py-1 rounded-full inline-flex items-center gap-1 border border-rose-800 mt-2"><svg class="w-4 h-4 inline"><use href="#icon-info"/></svg> ต้องกินต่อเนื่อง!</span>`
            : ''
          }`
      }
    </div>
  `;
};
