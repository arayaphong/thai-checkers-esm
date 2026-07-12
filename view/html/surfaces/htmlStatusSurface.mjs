import { statusClassMap } from '../styles/statusClassMap.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });

const buildBadge = (icon, labelText) => {
  const badge = h('div', '');
  const iconEl = h('span', 'text-lg');
  iconEl.textContent = icon;
  const textBox = h('div', 'text-xs leading-tight');
  const label = h('div', '');
  label.textContent = labelText;
  const role = h('div', 'text-neutral-500');
  textBox.append(label, role);
  badge.append(iconEl, textBox);
  return { badge, label, role };
};

const buildCount = (unitLabel, valueClass) => {
  const box = h('div', 'text-center');
  const value = h('div', valueClass);
  value.textContent = '0';
  const unit = h('div', '');
  unit.textContent = unitLabel;
  box.append(value, unit);
  return { box, value };
};

const buildTopRow = () => {
  const row = h('div', 'flex items-center justify-between mb-4');

  const badges = h('div', 'flex items-center gap-3');
  const { badge: whiteBadgeEl, label: whiteLabelEl, role: whiteRoleEl } = buildBadge('⚪', 'ขาว');
  const { badge: blackBadgeEl, label: blackLabelEl, role: blackRoleEl } = buildBadge('⚫', 'ดำ');
  const vs = h('span', 'text-neutral-600 font-bold text-lg');
  vs.textContent = 'vs';
  badges.append(whiteBadgeEl, vs, blackBadgeEl);

  const counts = h('div', 'flex gap-3 text-xs text-neutral-400');
  const { box: whiteCountBox, value: whiteCountEl } = buildCount(
    '⚪ หมาก',
    statusClassMap.pieceCountWhiteValue,
  );
  const { box: blackCountBox, value: blackCountEl } = buildCount(
    '⚫ หมาก',
    statusClassMap.pieceCountBlackValue,
  );
  const sep = h('div', 'text-neutral-600');
  sep.textContent = '|';
  counts.append(whiteCountBox, sep, blackCountBox);

  const resetBtnEl = h('button', statusClassMap.resetButton);
  resetBtnEl.id = 'resetBtn';
  resetBtnEl.innerHTML = '<svg class="w-4 h-4 inline"><use href="#icon-restart"/></svg> เริ่มใหม่';

  row.append(badges, counts, resetBtnEl);

  return {
    topRow: row,
    whiteBadgeEl,
    whiteLabelEl,
    whiteRoleEl,
    blackBadgeEl,
    blackLabelEl,
    blackRoleEl,
    whiteCountEl,
    blackCountEl,
    resetBtnEl,
  };
};

const buildMessageArea = () => {
  const area = h('div', 'text-center bg-neutral-800 rounded-xl p-3 border border-neutral-700');

  const messageRowEl = h('div', '');
  const resultEl = h('span', statusClassMap.resultBannerWinner);
  const aiThinkingEl = h('span', statusClassMap.aiThinkingText);
  aiThinkingEl.innerHTML =
    '<svg class="w-4 h-4 inline"><use href="#icon-bot"/></svg> AI กำลังคิด...';
  const turnMessageEl = h('span', '');
  const turnLabelEl = h('span', '');
  turnMessageEl.append('ตาของ: ', turnLabelEl);
  messageRowEl.append(resultEl, aiThinkingEl, turnMessageEl);

  const mandatoryWrapperEl = h('div', statusClassMap.hidden);
  const badge = h('span', statusClassMap.mandatoryCaptureBadge);
  badge.innerHTML = '<svg class="w-4 h-4 inline"><use href="#icon-info"/></svg> ต้องกินต่อเนื่อง!';
  mandatoryWrapperEl.append(h('br', ''), badge);

  area.append(messageRowEl, mandatoryWrapperEl);

  return {
    messageArea: area,
    turnMessageEl,
    turnLabelEl,
    aiThinkingEl,
    resultEl,
    mandatoryWrapperEl,
  };
};

const buildPanel = (panel) => {
  const { topRow, ...topRowEls } = buildTopRow();
  const { messageArea, ...messageAreaEls } = buildMessageArea();
  panel.append(topRow, messageArea);
  return { ...topRowEls, ...messageAreaEls };
};

// createUpdaters is a HOF that captures the DOM elements and returns
// an array of functions, each of which updates a part of the surface based on state.
const createUpdaters = ({
  whiteBadgeEl,
  whiteLabelEl,
  blackBadgeEl,
  blackLabelEl,
  whiteRoleEl,
  blackRoleEl,
  whiteCountEl,
  blackCountEl,
  resetBtnEl,
  turnMessageEl,
  turnLabelEl,
  aiThinkingEl,
  resultEl,
  mandatoryWrapperEl,
}) => {
  const showOnlyMessage = (visibleEl) => {
    [turnMessageEl, aiThinkingEl, resultEl].forEach((el) => {
      el.classList.toggle(statusClassMap.hidden, el !== visibleEl);
    });
  };

  const updateBadges = ({ turn }) => {
    const isWhiteTurn = turn === 'white';
    whiteBadgeEl.className = isWhiteTurn
      ? statusClassMap.turnBadgeActiveWhite
      : statusClassMap.turnBadgeInactive;
    whiteLabelEl.className = isWhiteTurn
      ? statusClassMap.whiteLabelActive
      : statusClassMap.whiteLabelInactive;
    blackBadgeEl.className = !isWhiteTurn
      ? statusClassMap.turnBadgeActiveBlack
      : statusClassMap.turnBadgeInactive;
    blackLabelEl.className = !isWhiteTurn
      ? statusClassMap.blackLabelActive
      : statusClassMap.blackLabelInactive;
  };

  const updateRoles = ({ gameConfig }) => {
    const role = (isAI) => (isAI ? '🤖 AI' : '👤 คน');
    whiteRoleEl.textContent = role(gameConfig.whiteIsAI);
    blackRoleEl.textContent = role(gameConfig.blackIsAI);
  };

  const updatePieceCounts = ({ pieceCounts }) => {
    whiteCountEl.textContent = String(pieceCounts.white);
    blackCountEl.textContent = String(pieceCounts.black);
  };

  const updateResetButton = ({ isRestartVisible }) => {
    resetBtnEl.classList.toggle(statusClassMap.hidden, !isRestartVisible);
  };

  const updateMessageArea = ({ turn, status, isAIThinking }) => {
    const isGameOver = status !== 'PLAYING';

    if (isGameOver) {
      const resultText = {
        white_wins: '⚪ ขาวชนะ!',
        black_wins: '⚫ ดำชนะ!',
        draw: 'เสมอ!',
      }[status];
      resultEl.textContent = resultText;
      showOnlyMessage(resultEl);
    } else if (isAIThinking) {
      showOnlyMessage(aiThinkingEl);
    } else {
      turnLabelEl.textContent = turn === 'white' ? 'ขาว' : 'ดำ';
      turnLabelEl.className =
        turn === 'white'
          ? statusClassMap.currentTurnLabelWhite
          : statusClassMap.currentTurnLabelBlack;
      showOnlyMessage(turnMessageEl);
    }
  };

  const updateMandatoryCapture = ({ mustMovePiece, isAIThinking }) => {
    mandatoryWrapperEl.classList.toggle(statusClassMap.hidden, !mustMovePiece || isAIThinking);
  };

  return [
    updateBadges,
    updateRoles,
    updatePieceCounts,
    updateResetButton,
    updateMessageArea,
    updateMandatoryCapture,
  ];
};

// ============================================
// createStatusSurface — owns DOM construction and CSS class assignment
// for the status panel.
// ============================================
export const createStatusSurface = (registry) => {
  const panel = registry.getStatusPanel();
  const elements = buildPanel(panel);

  const updaters = createUpdaters(elements);

  return {
    render: (state) => {
      updaters.forEach((update) => update(state));
    },
  };
};
