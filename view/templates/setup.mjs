export const MODES = Object.freeze([
  { k: 'pvp', l: '⚪ ผู้เล่น vs ⚫ ผู้เล่น', w: false, b: false },
  { k: 'pve', l: '⚪ ผู้เล่น vs ⚫ AI',      w: false, b: true  },
  { k: 'evp', l: '⚪ AI vs ⚫ ผู้เล่น',      w: true,  b: false },
  { k: 'eve', l: '⚪ AI vs ⚫ AI',           w: true,  b: true  },
]);

const DIFFICULTIES = Object.freeze([
  { k: 'easy',   l: 'สุ่ม',    d: 'Random'     },
  { k: 'medium', l: 'ฉลาด',   d: 'Greedy'     },
  { k: 'hard',   l: 'Minimax', d: 'Alpha-Beta' },
]);

export const renderSetupCollapsed = (cfg) => {
  const anyAI = cfg.whiteIsAI || cfg.blackIsAI;
  const aiInfo = anyAI
    ? ` <span class="text-gray-500">|</span> <span class="text-amber-400 text-xs">${cfg.aiDifficulty === 'easy' ? 'สุ่ม' : cfg.aiDifficulty === 'medium' ? 'ฉลาด' : 'Minimax'}</span>`
    : '';
  return `<button class="w-full flex items-center justify-between text-sm text-gray-400 hover:text-gray-200 transition-colors"><div class="flex items-center gap-3"><span class="font-medium">ตั้งค่าผู้เล่น:</span><span class="text-emerald-400">${cfg.whiteIsAI ? '🤖 AI' : '👤 คน'} vs ${cfg.blackIsAI ? '🤖 AI' : '👤 คน'}</span>${aiInfo}</div><span class="text-xs underline">แก้ไข</span></button>`;
};

export const renderSetupExpanded = (cfg) => {
  const anyAI = cfg.whiteIsAI || cfg.blackIsAI;
  const curMode = MODES.find(m => m.w === cfg.whiteIsAI && m.b === cfg.blackIsAI)?.k ?? 'pvp';

  const modeBtns = MODES.map(m =>
    `<button data-mode="${m.k}" class="px-3 py-2.5 rounded-lg text-sm font-semibold transition-all border ${curMode === m.k ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400' : 'bg-neutral-800 border-neutral-700 text-gray-400 hover:bg-neutral-750 hover:text-gray-200'}">${m.l}</button>`
  ).join('');

  const diffSection = anyAI ? `<label class="label">AI</label><div class="flex gap-2 mb-4">${
    DIFFICULTIES.map(d =>
      `<button data-diff="${d.k}" class="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all border ${cfg.aiDifficulty === d.k ? 'bg-amber-600/20 border-amber-500 text-amber-400' : 'bg-neutral-800 border-neutral-700 text-gray-400 hover:bg-neutral-750'}"><div>${d.l}</div><div class="text-[10px] font-normal opacity-70">${d.d}</div></button>`
    ).join('')
  }</div>` : '';

  return `
    <h2 class="text-lg font-bold text-gray-200 mb-4">ตั้งค่าผู้เล่น</h2>
    <label class="label">โหมดเกม</label>
    <div class="grid grid-cols-2 gap-2 mb-4">${modeBtns}</div>
    ${diffSection}
    <button id="startBtn" class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors text-lg mt-2">เริ่มเกม!</button>
  `;
};
