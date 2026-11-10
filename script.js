const views = {
  form: document.getElementById('view-form'),
  loading: document.getElementById('view-loading'),
  result: document.getElementById('view-result'),
  error: document.getElementById('view-error'),
};

function showView(name) {
  for (const key in views) {
    views[key].hidden = key !== name;
  }
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

function isSaved(image) {
  return loadDex().some((f) => f.image === image);
}

function updateSaveButton(side) {
  const { data } = recentFight;
  const image = side === 'A' ? data.imageA : data.imageB;
  const btn = saveButtons[side];
  btn.hidden = !image;
  const saved = !!image && isSaved(image);
  btn.disabled = saved;
  btn.textContent = saved ? 'Saved ✓' : 'Save to BattleDex';
}

function saveFighter(side) {
  const { data, fighterA, fighterB } = recentFight;
  const label = side === 'A' ? fighterA : fighterB;
  const image = side === 'A' ? data.imageA : data.imageB;
  if (!image || isSaved(image)) return;
  const ok = saveDex([...loadDex(), { label, image }]);
  saveStatus.textContent = ok ? '' : "Couldn't save: browser storage is full. Delete some fighters from the BattleDex.";
  updateSaveButton(side);
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
      showError(data.error || 'Something went wrong. Please try again.');
      return;
    }
    showResult(data, fighterA, fighterB);
  } catch {
    showError("Couldn't reach the server. Check your connection and try again.");
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
