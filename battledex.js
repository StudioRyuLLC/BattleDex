// BattleDex page: saved fighters as display-only trading cards.
function renderDex() {
  const list = loadDex();
  const grid = document.getElementById('dex-grid');
  grid.replaceChildren();
  list.forEach((fighter, index) => {
    const card = document.createElement('article');
    card.className = 'card';

    const img = document.createElement('img');
    img.src = fighter.image;
    img.alt = fighter.label;

    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = fighter.label;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'card-delete secondary';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete ${fighter.label}`);
    del.addEventListener('click', () => {
      const next = loadDex();
      next.splice(index, 1);
      saveDex(next);
      renderDex();
    });

    card.append(img, name, del);
    grid.append(card);
  });
  document.getElementById('dex-empty').hidden = list.length > 0;
  document.getElementById('dex-clear').hidden = list.length === 0;
}

document.getElementById('dex-recent').hidden = !loadRecentFight();
document.getElementById('dex-rematch').hidden = !loadRecentFight();
document.getElementById('dex-clear').addEventListener('click', () => {
  if (confirm('Delete all saved fighters?')) {
    saveDex([]);
    renderDex();
  }
});

renderDex();
