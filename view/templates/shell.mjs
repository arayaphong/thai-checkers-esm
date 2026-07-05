export const renderShell = () => `
    <div class="mb-6 text-center space-y-2">
      <h1 class="text-4xl font-black text-emerald-400 tracking-tight flex items-center justify-center gap-3">
        <svg class="w-10 h-10"><use href="#icon-crown"/></svg> หมากฮอสไทย
      </h1>
      <p class="text-gray-400 font-medium">Thai Checkers — Pure ESM</p>
    </div>
    <div id="setupPanel" class="bg-neutral-900 rounded-2xl p-5 w-full max-w-lg mb-6 border border-neutral-700"></div>
    <div id="gameArea" class="w-full flex flex-col items-center transition-opacity duration-500 opacity-30 pointer-events-none">
      <div id="statusPanel" class="bg-neutral-900 shadow-xl rounded-2xl p-5 w-full max-w-lg mb-6 border border-neutral-700"></div>
      <div class="relative group">
        <div class="absolute -inset-3 bg-gradient-to-br from-stone-700 to-stone-900 rounded-lg shadow-2xl shadow-black/60 z-0"></div>
        <div class="absolute -inset-1 bg-stone-800 rounded z-0"></div>
        <div id="board" class="relative z-10 grid grid-cols-8 grid-rows-8 w-[340px] h-[340px] sm:w-[480px] sm:h-[480px] border-2 border-stone-900 bg-stone-950 shadow-inner overflow-hidden"></div>
      </div>
    </div>
    <div class="mt-8 text-gray-400 text-sm max-w-lg text-center leading-relaxed">
      <p>เวอร์ชั่น 0.0.1</p>
    </div>
  `;
