const views = {
  form: document.getElementById('view-form'),
  loading: document.getElementById('view-loading'),
  result: document.getElementById('view-result'),
  error: document.getElementById('view-error'),
};

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

function startLoadingMessages() {
  if (loadingTimer) return;
  // Random start so repeat fights don't always open on the same phrase.
  let i = Math.floor(Math.random() * LOADING_MESSAGES.length);
  loadingMessageEl.textContent = LOADING_MESSAGES[i];
  loadingTimer = setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    loadingMessageEl.textContent = LOADING_MESSAGES[i];
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

function sideImage(side) {
  const { data } = recentFight;
  return side === 'A' ? data.imageA : data.imageB;
}

// BattleDex stores the compressed image (Stage 5), so "already saved" is
// checked against the compressed version. Compression is deterministic.
async function updateSaveButton(side) {
  const fight = recentFight;
  const image = sideImage(side);
  const btn = saveButtons[side];
  btn.hidden = !image;
  if (!image) return;
  btn.disabled = true; // until we know whether it's already saved
  try {
    const compressed = await compressImage(image);
    if (fight !== recentFight) return; // a newer fight replaced this one
    const saved = loadDex().some((f) => f.image === compressed);
    btn.disabled = saved;
    btn.textContent = saved ? 'Saved ✓' : 'Save to BattleDex';
  } catch {
    if (fight !== recentFight) return;
    btn.disabled = true;
    btn.textContent = "Can't save";
  }
}

async function saveFighter(side) {
  const fight = recentFight;
  const label = side === 'A' ? fight.fighterA : fight.fighterB;
  const image = sideImage(side);
  if (!image) return;
  try {
    const compressed = await compressImage(image);
    const dex = loadDex();
    if (!dex.some((f) => f.image === compressed)) {
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

function showResult(data, fighterA, fighterB) {
  const { winner, reasoning, imageA, imageB } = data;
  recentFight = { data, fighterA, fighterB };
  saveRecentFight(recentFight);
  document.getElementById('result-winner').textContent = `${winner} wins!`;
  document.getElementById('result-reasoning').textContent = reasoning;
  setFighterImage('result-image-a', imageA, fighterA);
  setFighterImage('result-image-b', imageB, fighterB);
  document.getElementById('result-fighters').hidden = !(imageA || imageB);
  saveStatus.textContent = '';
  updateSaveButton('A');
  updateSaveButton('B');
  showView('result');
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  showView('error');
}

async function runFight(fighterA, fighterB) {
  showView('loading');
  try {
    const res = await fetch('/api/fight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fighterA, fighterB }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
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
  const fighterA = document.getElementById('fighter-a').value.trim();
  const fighterB = document.getElementById('fighter-b').value.trim();
  runFight(fighterA, fighterB);
});

document.getElementById('result-again').addEventListener('click', () => showView('form'));
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

for (const id of ['fighter-a', 'fighter-b']) {
  document.getElementById(id).addEventListener('input', (e) => {
    const atLimit = e.target.value.length >= MAX_NAME_LENGTH;
    formHint.textContent = atLimit ? NAME_TOO_LONG_MESSAGE : '';
    formHint.hidden = !atLimit;
  });
}
