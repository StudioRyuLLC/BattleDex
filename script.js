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

function showResult({ winner, reasoning, imageA, imageB }, fighterA, fighterB) {
  document.getElementById('result-winner').textContent = `${winner} wins!`;
  document.getElementById('result-reasoning').textContent = reasoning;
  setFighterImage('result-image-a', imageA, fighterA);
  setFighterImage('result-image-b', imageB, fighterB);
  document.getElementById('result-fighters').hidden = !(imageA || imageB);
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
      // 429 / 400 / 502 all carry a clear message from the API.
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
