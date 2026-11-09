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

function showResult({ winner, reasoning, imageA, imageB }) {
  document.getElementById('result-winner').textContent = `${winner} wins!`;
  document.getElementById('result-reasoning').textContent = reasoning;
  // Images arrive in a later Stage 3 step; hide the slots until then.
  document.getElementById('result-fighters').hidden = !(imageA && imageB);
  if (imageA) document.getElementById('result-image-a').src = imageA;
  if (imageB) document.getElementById('result-image-b').src = imageB;
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
    showResult(data);
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
