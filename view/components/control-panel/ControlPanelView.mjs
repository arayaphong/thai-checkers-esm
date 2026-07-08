const MODE_OPTIONS = Object.freeze([
  { key: 'pvp', label: '⚪ ผู้เล่น vs ⚫ ผู้เล่น', whiteIsAI: false, blackIsAI: false },
  { key: 'pve', label: '⚪ ผู้เล่น vs ⚫ AI', whiteIsAI: false, blackIsAI: true },
  { key: 'evp', label: '⚪ AI vs ⚫ ผู้เล่น', whiteIsAI: true, blackIsAI: false },
  { key: 'eve', label: '⚪ AI vs ⚫ AI', whiteIsAI: true, blackIsAI: true },
]);

const DIFFICULTY_OPTIONS = Object.freeze([
  { key: 'easy', label: 'สุ่ม', description: 'Random' },
  { key: 'medium', label: 'ฉลาด', description: 'Greedy' },
  { key: 'hard', label: 'Minimax', description: 'Alpha-Beta' },
]);

export const createControlPanelView = (controlPanelSurface) => {
  controlPanelSurface.buildModeButtons(MODE_OPTIONS.map(({ key, label }) => ({ key, label })));
  controlPanelSurface.buildDifficultyButtons(DIFFICULTY_OPTIONS);

  return {
    modeOptions: MODE_OPTIONS,
    difficultyOptions: DIFFICULTY_OPTIONS,

    render(state) {
      const { collapsed, gameConfig } = state;
      const { whiteIsAI, blackIsAI, aiDifficulty } = gameConfig;

      const anyAI = whiteIsAI || blackIsAI;
      const difficultyLabel = anyAI ? (DIFFICULTY_OPTIONS.find((d) => d.key === aiDifficulty)?.label ?? aiDifficulty) : null;

      const whiteText = whiteIsAI ? '🤖 AI' : '👤 คน';
      const blackText = blackIsAI ? '🤖 AI' : '👤 คน';

      const selectedMode = MODE_OPTIONS.find((m) => m.whiteIsAI === whiteIsAI && m.blackIsAI === blackIsAI)?.key ?? 'pvp';

      controlPanelSurface.render({
        isCollapsed: collapsed,
        gameConfig: { whiteText, blackText, difficultyLabel },
        selectedMode,
        selectedDifficulty: aiDifficulty,
        isDifficultyVisible: anyAI,
        isStartButtonVisible: !collapsed,
        isStartButtonEnabled: true,
      });
    },
  };
};
