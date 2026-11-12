const views = {
  form: document.getElementById('view-form'),
  loading: document.getElementById('view-loading'),
  result: document.getElementById('view-result'),
  error: document.getElementById('view-error'),
};

// Shift the page's ember glow toward the winner (A = left, B = right).
const root = document.documentElement;
function setSpotlight(side) {
  root.style.setProperty('--spot-x', side === 'A' ? '30%' : side === 'B' ? '70%' : '50%');
}

// Re-run a CSS animation by removing the class, forcing a reflow, re-adding it.
function restartAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Rotating loading messages, shown only while the loading view is visible.
const LOADING_MESSAGES = [
  'Sharpening claws...',
  'Honing blades...',
  'Consulting the ancient scrolls...',
  'Polishing the battle armor...',
  'Rallying the roaring crowd...',
  'Oiling the war drums...',
  'Warming up the dragon...',
  'Summoning the arena judge...',
  'Stretching before the brawl...',
  'Whispering to the battle spirits...',
  'Painting the war portraits...',
];
const loadingMessageEl = document.getElementById('loading-message');
let loadingTimer = null;

function setLoadingMessage(text) {
  loadingMessageEl.textContent = text;
  restartAnimation(loadingMessageEl, 'msg-in');
}

function startLoadingMessages() {
  if (loadingTimer) return;
  // Random start so repeat fights don't always open on the same phrase.
  let i = Math.floor(Math.random() * LOADING_MESSAGES.length);
  setLoadingMessage(LOADING_MESSAGES[i]);
  loadingTimer = setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    setLoadingMessage(LOADING_MESSAGES[i]);
  }, 2200);
}

function stopLoadingMessages() {
  clearInterval(loadingTimer);
  loadingTimer = null;
}

function showView(name) {
  for (const key in views) {
    views[key].hidden = key !== name;
  }
  if (name === 'loading') startLoadingMessages();
  else stopLoadingMessages();
  if (name !== 'result') setSpotlight(null);
  document.getElementById('result-nav').hidden = name !== 'result';
}

// Storage helpers (loadDex/saveDex/recent fight) come from dex-store.js.
// The recent fight is also mirrored to sessionStorage so battledex.html
// can link back to it; it is never part of the saved BattleDex.
let recentFight = null; // { data, fighterA, fighterB }

const saveButtons = {
  A: document.getElementById('save-a'),
  B: document.getElementById('save-b'),
};
const saveStatus = document.getElementById('save-status');

// Save buttons hold an icon plus a text label; update both together.
function setSaveButton(btn, icon, label) {
  btn.querySelector('use').setAttribute('href', '#i-' + icon);
  btn.querySelector('.label').textContent = label;
}

function sideImage(side) {
  const { data } = recentFight;
  return side === 'A' ? data.imageA : data.imageB;
}

// BattleDex stores the compressed image (Stage 5), so "already saved" is
// checked against the compressed version. Compression is deterministic.
// "Already saved" is decided by normalized fighter name (trimmed, case-insensitive),
// so a BattleDex fighter re-entered in a new fight never gets a second entry
// and its existing portrait is never overwritten.
function updateSaveButton(side) {
  const image = sideImage(side);
  const btn = saveButtons[side];
  btn.hidden = !image;
  if (!image) return;
  const label = side === 'A' ? recentFight.fighterA : recentFight.fighterB;
  const saved = isNameSaved(loadDex(), label);
  btn.disabled = saved;
  if (saved) setSaveButton(btn, 'check', 'Already in BattleDex');
  else setSaveButton(btn, 'bookmark-plus', 'Save to BattleDex');
}

async function saveFighter(side) {
  const fight = recentFight;
  const label = side === 'A' ? fight.fighterA : fight.fighterB;
  const image = sideImage(side);
  if (!image) return;
  try {
    const compressed = await compressImage(image);
    const dex = loadDex();
    if (!isNameSaved(dex, label)) {
      const ok = saveDex([...dex, { label, image: compressed }]);
      saveStatus.textContent = ok ? '' : "Couldn't save: browser storage is full. Delete some fighters from the BattleDex.";
    }
  } catch {
    saveStatus.textContent = "Couldn't prepare that image for saving.";
  }
  if (fight === recentFight) updateSaveButton(side);
}


saveButtons.A.addEventListener('click', () => saveFighter('A'));
saveButtons.B.addEventListener('click', () => saveFighter('B'));

// --- Fight flow ---
function setFighterImage(id, src, label) {
  const img = document.getElementById(id);
  if (src) {
    img.src = src; // URL or data: URI from the API
    img.alt = label;
    img.hidden = false;
  } else {
    // Clear any image left over from a previous fight.
    img.removeAttribute('src');
    img.hidden = true;
  }
}

// Victor is always displayed first (top when stacked, left side-by-side). Fighter A/B
// identities (ids, names, save buttons, challenge handlers) stay attached to their
// own elements; only the DOM order changes. Moving real nodes keeps tab order in
// step with the visual order.
function placeVictorFirst(side) {
  const box = document.getElementById('result-fighters');
  const disc = box.querySelector('.vs-disc');
  const first = document.getElementById(side === 'B' ? 'fig-b' : 'fig-a');
  box.prepend(first);
  first.after(disc);
}

function showResult(data, fighterA, fighterB) {
  const { winner, reasoning, imageA, imageB } = data;
  recentFight = { data, fighterA, fighterB };
  saveRecentFight(recentFight);
  document.getElementById('result-winner').textContent = `${winner} wins!`;
  document.getElementById('result-reasoning').textContent = reasoning;
  setFighterImage('result-image-a', imageA, fighterA);
  setFighterImage('result-image-b', imageB, fighterB);
  document.getElementById('name-a').textContent = fighterA;
  document.getElementById('name-b').textContent = fighterB;
  saveStatus.textContent = '';
  updateSaveButton('A');
  updateSaveButton('B');

  // Mark the winner. winnerSide comes from the API; fall back to name match.
  const side =
    data.winnerSide === 'A' || data.winnerSide === 'B'
      ? data.winnerSide
      : winner === fighterA ? 'A' : winner === fighterB ? 'B' : null;
  const figs = { A: document.getElementById('fig-a'), B: document.getElementById('fig-b') };
  figs.A.classList.remove('is-winner', 'is-loser');
  figs.B.classList.remove('is-winner', 'is-loser');
  placeVictorFirst(side);
  showView('result');
  void figs.A.offsetWidth; // force reflow so the entrance animations replay
  if (side) {
    figs[side].classList.add('is-winner');
    figs[side === 'A' ? 'B' : 'A'].classList.add('is-loser');
  }
  setSpotlight(side ? 'A' : null); // the victor is always shown first (left / top)
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  showView('error');
}

async function runFight(fighterA, fighterB) {
  document.getElementById('loading-a').textContent = fighterA;
  document.getElementById('loading-b').textContent = fighterB;
  showView('loading');
  try {
    const res = await fetch('/api/fight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fighterA, fighterB }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'invalid_matchup') {
        // Server-side matchup rejection: give the names back so they can be fixed.
        fillForm(fighterA, fighterB);
        showFormHint(data.error);
        return;
      }
      // 429 / 400 / 422 / 502 all carry a clear message from the API.
      showError(data.error || 'Zounds! Some mischievous gremlin has snuffed the torches and the tale was lost. Take heart and try again!');
      return;
    }
    showResult(data, fighterA, fighterB);
  } catch {
    showError("The messenger raven never returned! The road to the arena is cut. Check thy connection, then sound the horn once more!");
  }
}

document.getElementById('fight-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inputA = document.getElementById('fighter-a');
  const inputB = document.getElementById('fighter-b');
  // Keep the submitted values in local variables so the fight completes,
  // then clear the form so "Fight again" starts with empty fields.
  const fighterA = inputA.value.trim();
  const fighterB = inputB.value.trim();
  const check = validateMatchup(fighterA, fighterB);
  if (!check.ok) {
    showFormHint(check.message); // names stay in the inputs for correction
    return;
  }
  inputA.value = '';
  inputB.value = '';
  formHint.hidden = true;
  formHint.textContent = '';
  updateCounters();
  runFight(fighterA, fighterB);
});

function showFormHint(message) {
  formHint.textContent = message;
  formHint.hidden = !message;
}

// Challenge from the result page: clicked fighter becomes Fighter A, B left empty.
for (const [id, side] of [['fig-a', 'A'], ['fig-b', 'B']]) {
  const stage = document.querySelector('#' + id + ' .stage');
  const challenge = () => {
    if (!recentFight) return;
    fillForm(side === 'A' ? recentFight.fighterA : recentFight.fighterB, '');
    document.getElementById('fighter-b').focus();
  };
  stage.setAttribute('aria-label', 'Challenge this fighter to a new bout');
  stage.addEventListener('click', challenge);
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      challenge();
    }
  });
}

// Form fill helper shared by Rematch (prefilled) and Fight again (empty).
function fillForm(a, b) {
  document.getElementById('fighter-a').value = a;
  document.getElementById('fighter-b').value = b;
  formHint.hidden = true;
  formHint.textContent = '';
  updateCounters();
  showView('form');
}

// Rematch: prefill from the most recent fight (editable, not auto-submitted).
document.getElementById('nav-rematch').addEventListener('click', () => {
  if (recentFight) fillForm(recentFight.fighterA, recentFight.fighterB);
  else fillForm('', '');
});
document.getElementById('nav-again').addEventListener('click', () => fillForm('', ''));
document.getElementById('result-again').addEventListener('click', () => fillForm('', ''));
document.getElementById('error-again').addEventListener('click', () => showView('form'));

// Coming back from battledex.html via "Back to recent fight".
if (location.hash === '#recent') {
  const saved = loadRecentFight();
  if (saved) showResult(saved.data, saved.fighterA, saved.fighterB);
}

// Fighter name limit (matches MAX_NAME_LENGTH in api/fight.js). The inputs
// have maxlength so typing/pasting stops at the limit; tell the user why.
const MAX_NAME_LENGTH = 50;
const formHint = document.getElementById('form-hint');
const NAME_TOO_LONG_MESSAGE = `Hold, mighty challenger! Thy name has outgrown the arena banner. The herald can bellow only ${MAX_NAME_LENGTH} letters, so trim thy title!`;

// Live "n / 50" counters next to each input.
function updateCounters() {
  document.getElementById('count-a').textContent =
    document.getElementById('fighter-a').value.length + ' / ' + MAX_NAME_LENGTH;
  document.getElementById('count-b').textContent =
    document.getElementById('fighter-b').value.length + ' / ' + MAX_NAME_LENGTH;
}

for (const id of ['fighter-a', 'fighter-b']) {
  document.getElementById(id).addEventListener('input', (e) => {
    const atLimit = e.target.value.length >= MAX_NAME_LENGTH;
    formHint.textContent = atLimit ? NAME_TOO_LONG_MESSAGE : '';
    formHint.hidden = !atLimit;
    updateCounters();
  });
}

// Rematch from BattleDex: prefill both fields with the most recent fight's
// fighters. Any other way into the form leaves the fields empty.
if (location.hash === '#rematch') {
  const saved = loadRecentFight();
  if (saved) {
    document.getElementById('fighter-a').value = saved.fighterA;
    document.getElementById('fighter-b').value = saved.fighterB;
    updateCounters();
  }
  showView('form');
}

// BattleDex "Fight": two picked fighters start a normal fight right away.
if (location.hash === '#fight') {
  const pending = takePendingFight();
  history.replaceState(null, '', location.pathname); // reload won't refight
  if (pending && pending.fighterB) {
    const check = validateMatchup(pending.fighterA, pending.fighterB);
    if (check.ok) runFight(pending.fighterA, pending.fighterB);
    else {
      fillForm(pending.fighterA, pending.fighterB);
      showFormHint(check.message);
    }
  }
}

// BattleDex "Challenge new fighter": selected fighter becomes A, B left empty. No auto-fight.
if (location.hash === '#challenge') {
  const pending = takePendingFight();
  history.replaceState(null, '', location.pathname);
  if (pending) {
    fillForm(pending.fighterA, '');
    document.getElementById('fighter-b').focus();
    if (isProtectedName(pending.fighterA)) showFormHint(PROTECTED_MESSAGE);
  }
}
