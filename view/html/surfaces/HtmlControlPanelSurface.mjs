import { controlPanelClassMap } from '../styles/controlPanelClassMap.mjs';
import { layoutClassMap } from '../styles/layoutClassMap.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });

const createUpdaters = ({
  collapsedEl,
  collapsedModeTextEl,
  collapsedDifficultyWrapperEl,
  collapsedDifficultyTextEl,
  expandedEl,
  modeButtons,
  difficultyLabelEl,
  difficultyRowEl,
  difficultyButtons,
  startBtnEl,
  cancelBtnEl,
}) => {
  const updateVisibility = ({ isCollapsed }) => {
    collapsedEl.classList.toggle(controlPanelClassMap.hidden, !isCollapsed);
    expandedEl.classList.toggle(controlPanelClassMap.hidden, isCollapsed);
  };

  const updateCollapsedText = ({ isCollapsed, gameConfig }) => {
    if (!isCollapsed) return;

    const { whiteText, blackText, difficultyLabel } = gameConfig;
    collapsedModeTextEl.textContent = `${whiteText} vs ${blackText}`;
    const hasDifficulty = !!difficultyLabel;
    collapsedDifficultyWrapperEl.classList.toggle(controlPanelClassMap.hidden, !hasDifficulty);
    if (hasDifficulty) {
      collapsedDifficultyTextEl.textContent = difficultyLabel;
    }
  };

  const updateModeButtons = ({ selectedMode }) => {
    modeButtons.forEach((btn, key) => {
      btn.className =
        key === selectedMode
          ? controlPanelClassMap.modeButtonSelected
          : controlPanelClassMap.modeButtonUnselected;
    });
  };

  const updateDifficultyButtons = ({ selectedDifficulty }) => {
    difficultyButtons.forEach((btn, key) => {
      btn.className =
        key === selectedDifficulty
          ? controlPanelClassMap.difficultyButtonSelected
          : controlPanelClassMap.difficultyButtonUnselected;
    });
  };

  const updateDifficultyVisibility = ({ isDifficultyVisible }) => {
    difficultyLabelEl.classList.toggle(controlPanelClassMap.hidden, !isDifficultyVisible);
    difficultyRowEl.classList.toggle(controlPanelClassMap.hidden, !isDifficultyVisible);
  };

  const updateStartButton = ({ isStartButtonVisible, isStartButtonEnabled }) => {
    startBtnEl.classList.toggle(controlPanelClassMap.hidden, !isStartButtonVisible);
    startBtnEl.disabled = !isStartButtonEnabled;
  };

  const updateCancelButton = ({ isCancelable }) => {
    cancelBtnEl.classList.toggle(controlPanelClassMap.hidden, !isCancelable);
  };

  return [
    updateVisibility,
    updateCollapsedText,
    updateModeButtons,
    updateDifficultyButtons,
    updateDifficultyVisibility,
    updateStartButton,
    updateCancelButton,
  ];
};

const buildCollapsed = () => {
  const collapsedToggleBtnEl = h('button', controlPanelClassMap.collapsedToggle);
  collapsedToggleBtnEl.dataset.uiRole = 'setupPanel';
  const row = h('div', 'flex items-center gap-3');
  const label = h('span', 'font-medium');
  label.textContent = 'ตั้งค่าผู้เล่น:';
  const collapsedModeTextEl = h('span', controlPanelClassMap.collapsedModeLabel);
  const collapsedDifficultyWrapperEl = h('span', controlPanelClassMap.hidden);
  const sep = h('span', 'text-gray-500');
  sep.textContent = '|';
  const collapsedDifficultyTextEl = h('span', controlPanelClassMap.collapsedDifficultyLabel);
  collapsedDifficultyWrapperEl.append(' ', sep, ' ', collapsedDifficultyTextEl);
  row.append(label, collapsedModeTextEl, collapsedDifficultyWrapperEl);
  const hint = h('span', controlPanelClassMap.collapsedEditHint);
  hint.textContent = 'แก้ไข';
  collapsedToggleBtnEl.append(row, hint);

  const collapsedEl = h('div', controlPanelClassMap.hidden);
  collapsedEl.append(collapsedToggleBtnEl);

  return {
    collapsedEl,
    collapsedToggleBtnEl,
    collapsedModeTextEl,
    collapsedDifficultyWrapperEl,
    collapsedDifficultyTextEl,
  };
};

const buildExpanded = () => {
  const expandedEl = h('div', '');
  const titleRowEl = h('div', 'flex items-center justify-between mb-4');
  const title = h('h2', 'text-lg font-bold text-gray-200');
  title.textContent = 'ตั้งค่าผู้เล่น';
  const cancelBtnEl = h('button', controlPanelClassMap.collapsedEditHint);
  cancelBtnEl.id = 'cancelBtn';
  cancelBtnEl.textContent = 'ยกเลิก';
  titleRowEl.append(title, cancelBtnEl);

  const modeLabel = h('label', 'label');
  modeLabel.textContent = 'โหมดเกม';
  const modeGridEl = h('div', controlPanelClassMap.modeGrid);
  const modeButtons = new Map();
  const difficultyLabelEl = h('label', 'label');
  difficultyLabelEl.textContent = 'AI';
  const difficultyRowEl = h('div', controlPanelClassMap.difficultyRow);
  const difficultyButtons = new Map();
  const startBtnEl = h('button', controlPanelClassMap.startButton);
  startBtnEl.id = 'startBtn';
  startBtnEl.textContent = 'เริ่มเกม!';

  expandedEl.append(
    titleRowEl,
    modeLabel,
    modeGridEl,
    difficultyLabelEl,
    difficultyRowEl,
    startBtnEl,
  );

  return {
    expandedEl,
    modeGridEl,
    modeButtons,
    difficultyLabelEl,
    difficultyRowEl,
    difficultyButtons,
    startBtnEl,
    cancelBtnEl,
  };
};

const buildPanel = (panel) => {
  const { collapsedEl, ...collapsedEls } = buildCollapsed();
  const { expandedEl, ...expandedEls } = buildExpanded();
  panel.append(collapsedEl, expandedEl);
  return { ...collapsedEls, ...expandedEls, collapsedEl, expandedEl };
};

// ============================================
// createControlPanelSurface — owns DOM construction and CSS class
// assignment for the setup / control panel. Builds both the collapsed
// summary and the expanded form once and toggles between them, rather
// than re-rendering from a template string on every sync like the
// legacy view used to.
// ============================================
export const createControlPanelSurface = (registry) => {
  const panel = registry.getSetupPanel();
  const elements = buildPanel(panel);
  const updaters = createUpdaters(elements);

  return {
    render(state) {
      updaters.forEach((updater) => updater(state));
    },
    getCollapsedToggleButton: () => elements.collapsedToggleBtnEl,
    getCancelButton: () => elements.cancelBtnEl,
    getModeButton: (key) => elements.modeButtons.get(key),
    getDifficultyButton: (key) => elements.difficultyButtons.get(key),
    getStartButton: () => elements.startBtnEl,
    buildModeButtons: (modes) => {
      elements.modeGridEl.innerHTML = '';
      elements.modeButtons.clear();
      modes.forEach(({ key, label }) => {
        const btn = h('button', controlPanelClassMap.modeButtonUnselected);
        btn.dataset.mode = key;
        btn.textContent = label;
        elements.modeGridEl.append(btn);
        elements.modeButtons.set(key, btn);
      });
    },
    buildDifficultyButtons: (options) => {
      elements.difficultyRowEl.innerHTML = '';
      elements.difficultyButtons.clear();
      options.forEach(({ key, label, description }) => {
        const btn = h('button', controlPanelClassMap.difficultyButtonUnselected);
        btn.dataset.diff = key;
        const labelEl = h('div', '');
        labelEl.textContent = label;
        const descEl = h('div', controlPanelClassMap.difficultyDescription);
        descEl.textContent = description;
        btn.append(labelEl, descEl);
        elements.difficultyRowEl.append(btn);
        elements.difficultyButtons.set(key, btn);
      });
    },
  };
};
