// BattleDex page: saved fighters as display-only trading cards.
function renderDex() {
  const list = loadDex();
  const grid = document.getElementById('dex-grid');
  grid.replaceChildren();
  list.forEach((fighter, index) => {
    const card = document.createElement('article');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card-top';

    const no = document.createElement('span');
    no.className = 'card-no';
    no.textContent = `No. ${String(index + 1).padStart(3, '0')}`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'card-delete';
    del.setAttribute('aria-label', `Delete ${fighter.label}`);
    del.append(makeIcon('trash'));
    del.addEventListener('click', () => {
      const next = loadDex();
      next.splice(index, 1);
      saveDex(next);
      renderDex();
    });

    top.append(no, del);

    const img = document.createElement('img');
    img.src = fighter.image;
    img.alt = fighter.label;

    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = fighter.label;

    card.append(top, img, name);
    grid.append(card);
  });

  const n = list.length;
  document.getElementById('dex-count').textContent =
    n === 0
      ? 'No champions enshrined in thy chronicle yet.'
      : `${n} ${n === 1 ? 'champion' : 'champions'} enshrined in thy chronicle.`;
  document.getElementById('dex-empty').hidden = n > 0;
  document.getElementById('dex-clear').hidden = n === 0;
}

document.getElementById('dex-recent').hidden = !loadRecentFight();
document.getElementById('dex-rematch').hidden = !loadRecentFight();
const confirmBox = document.getElementById('confirm-clear');
const clearBtn = document.getElementById('dex-clear');

function closeConfirm() {
  confirmBox.hidden = true;
  clearBtn.focus();
}

clearBtn.addEventListener('click', () => {
  confirmBox.hidden = false;
  document.getElementById('confirm-cancel').focus();
});
document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
confirmBox.addEventListener('click', (e) => {
  if (e.target === confirmBox) closeConfirm();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !confirmBox.hidden) closeConfirm();
});
document.getElementById('confirm-yes').addEventListener('click', () => {
  saveDex([]);
  renderDex();
  confirmBox.hidden = true;
});

renderDex();
