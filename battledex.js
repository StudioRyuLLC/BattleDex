// BattleDex page: saved fighters as trading cards, newest first.
// Cards can be selected (max 2) to start a fight between them.
const MAX_SELECTED = 2;
const selected = new Set(); // image data URIs (unique per fighter, see duplicate detection)

const newBtn = document.getElementById('dex-new');
const newLabel = document.getElementById('dex-new-label');
const selectHint = document.getElementById('dex-select-hint');

function updateActionButton(list) {
  // Drop selections whose fighter no longer exists.
  for (const img of [...selected]) if (!list.some((f) => f.image === img)) selected.delete(img);
  const n = selected.size;
  newLabel.textContent = n === 0 ? 'New fight' : n === 1 ? 'Challenge new fighter' : 'Fight';
  selectHint.hidden = n === 0;
  selectHint.textContent =
    n === 1 ? 'One fighter chosen. Challenge a new fighter, or select one more to fight.'
    : n === MAX_SELECTED ? 'Two fighters chosen. Press Fight to confirm the matchup, or tap one to deselect.' : '';
  document.querySelectorAll('.card').forEach((card) => {
    const on = selected.has(card.dataset.image);
    card.classList.toggle('is-selected', on);
    card.querySelector('.card-select').setAttribute('aria-pressed', String(on));
  });
  updateCount(list);
  updateFloatFight();
}

function toggleSelect(image) {
  if (selected.has(image)) selected.delete(image);
  else if (selected.size < MAX_SELECTED) {
    selected.add(image);
    const f = loadDex().find((x) => x.image === image);
    if (f) guarded(() => BGAudio.say(`${f.label} selected`));
  }
  else {
    selectHint.hidden = false;
    selectHint.textContent = 'Only two fighters may enter the ring. Deselect one first.';
    return;
  }
  updateActionButton(loadDex());
}

// Floating "Fight (2)": shown when exactly two are selected, the main button is
// scrolled out of view and the dialog is closed. Opens the same dialog.
const floatFight = document.getElementById('dex-float-fight');
let newBtnInView = true;
function updateFloatFight() {
  floatFight.hidden = !(selected.size === MAX_SELECTED && !newBtnInView) || !fightModal.hidden;
}
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    newBtnInView = entries[entries.length - 1].isIntersecting;
    updateFloatFight();
  }).observe(newBtn);
}
floatFight.addEventListener('click', () => onFightClick(floatFight));

function guarded(fn) {
  try {
    fn();
  } catch {
    // optional feature failed; the page keeps working
  }
}
guarded(() => BGAudio.setScene('dex'));

// Selected fighters in the order they were picked (Set keeps insertion order):
// first pick = Fighter A, second pick = Fighter B.
function pickedFighters() {
  const dex = loadDex();
  return [...selected].map((img) => dex.find((f) => f.image === img)).filter(Boolean);
}

function showHint(text) {
  selectHint.hidden = false;
  selectHint.textContent = text;
}

const fightModal = document.getElementById('confirm-fight');
const modalFightBtn = document.getElementById('fight-go');
const modalCancelBtn = document.getElementById('fight-cancel');
const backgroundEls = [document.querySelector('.site-header'), document.querySelector('main'), document.querySelector('.version-switch'), document.querySelector('.foot')];

let modalOpener = newBtn; // which Fight button opened the dialog (focus returns there)

function openFightModal(a, b, opener) {
  modalOpener = opener || newBtn;
  document.body.classList.add('modal-open'); // hides floating controls, locks scroll
  document.getElementById('confirm-a').textContent = a;
  document.getElementById('confirm-b').textContent = b;
  backgroundEls.forEach((el) => el && (el.inert = true)); // blocks background clicks, focus and AT
  fightModal.hidden = false;
  modalFightBtn.focus();
}

function closeFightModal() {
  fightModal.hidden = true;
  backgroundEls.forEach((el) => el && (el.inert = false));
  document.body.classList.remove('modal-open');
  updateFloatFight();
  // Selections are kept. Return focus to the opener (or the main button if the
  // floating one is gone) without scrolling the page.
  (modalOpener.hidden ? newBtn : modalOpener).focus({ preventScroll: true });
}

function onFightClick(opener) {
  const picked = pickedFighters();
  if (picked.length === 0) {
    location.href = 'index.html#new'; // the marker keeps index.html from sending us back here
    return;
  }
  if (picked.length === 1) {
    if (savePendingFight(picked[0].label, '')) location.href = 'index.html#challenge';
    return;
  }
  const check = validateMatchup(picked[0].label, picked[1].label);
  if (!check.ok) return showHint(check.message);
  openFightModal(picked[0].label, picked[1].label, opener);
}
newBtn.addEventListener('click', () => onFightClick(newBtn));

modalCancelBtn.addEventListener('click', closeFightModal);
modalFightBtn.addEventListener('click', () => {
  const picked = pickedFighters();
  if (picked.length !== MAX_SELECTED) return closeFightModal();
  if (savePendingFight(picked[0].label, picked[1].label)) location.href = 'index.html#fight';
});
fightModal.addEventListener('click', (e) => {
  if (e.target === fightModal) closeFightModal();
});
// Escape cancels; Tab / Shift+Tab cycle inside the dialog.
fightModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeFightModal();
  } else if (e.key === 'Tab') {
    const first = modalCancelBtn, last = modalFightBtn;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

// ---------- Search (only when MORE than 10 fighters are saved) ----------
// Filtering only hides/shows existing cards: stored data, selections and selection order
// (the `selected` Set) are never touched, and there are no network requests.
const SEARCH_MIN_FIGHTERS = 10;
const searchBox = document.getElementById('dex-search');
const searchInput = document.getElementById('dex-search-input');
const searchClear = document.getElementById('dex-search-clear');
const searchEmpty = document.getElementById('dex-search-empty');
const searchStatus = document.getElementById('dex-search-status');
const dexGrid = document.getElementById('dex-grid');

const normQuery = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase();

function updateCount(list) {
  const total = list.length;
  const q = normQuery(searchInput.value);
  const shown = document.querySelectorAll('.card:not([hidden])').length;
  let text =
    total === 0
      ? 'No champions enshrined in thy chronicle yet.'
      : q && !searchBox.hidden
        ? `Showing ${shown} of ${total} champions.`
        : `${total} ${total === 1 ? 'champion' : 'champions'} enshrined in thy chronicle.`;
  if (selected.size > 0) text += ` ${selected.size} selected.`;
  document.getElementById('dex-count').textContent = text;
}

function applyFilter() {
  const list = loadDex();
  const searching = list.length > SEARCH_MIN_FIGHTERS;
  searchBox.hidden = !searching;
  dexGrid.classList.toggle('has-preview', searching);
  if (!searching) searchInput.value = '';
  const q = searching ? normQuery(searchInput.value) : '';
  let shown = 0;
  document.querySelectorAll('.card').forEach((card) => {
    const match = !q || card.dataset.label.toLowerCase().includes(q);
    card.hidden = !match;
    if (match) shown++;
  });
  dexGrid.dataset.perRow = String(Math.min(Math.max(shown, 1), 4)); // 1-3 cards get bigger cards; 4+ use four per row
  searchClear.hidden = !(searching && searchInput.value.length > 0);
  const none = searching && q !== '' && shown === 0;
  searchEmpty.hidden = !none;
  searchEmpty.textContent = none ? `No fighters match "${searchInput.value.trim()}". Clear the search to see everyone.` : '';
  searchStatus.textContent = searching && q ? (none ? 'No matching fighters.' : `Showing ${shown} of ${list.length} fighters.`) : '';
  updateCount(list);
}

function clearSearch() {
  searchInput.value = '';
  applyFilter();
  searchInput.focus();
}

searchInput.addEventListener('input', applyFilter);
searchClear.addEventListener('click', clearSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && searchInput.value) {
    e.preventDefault();
    clearSearch();
  }
});

// ---------- Preview dialog (reuses toggleSelect, so there is one source of truth) ----------
const previewModal = document.getElementById('preview-modal');
const previewImg = document.getElementById('preview-img');
const previewTitle = document.getElementById('preview-title');
const previewNote = document.getElementById('preview-note');
const previewSelect = document.getElementById('preview-select');
const previewClose = document.getElementById('preview-close');
let previewImage = null;
let previewOpener = null;

function refreshPreview() {
  const isOn = selected.has(previewImage);
  const full = !isOn && selected.size >= MAX_SELECTED;
  previewSelect.querySelector('span').textContent = isOn ? 'Deselect fighter' : 'Select fighter';
  previewSelect.disabled = full;
  previewNote.hidden = !full;
}

function openPreview(fighter, opener) {
  previewImage = fighter.image;
  previewOpener = opener;
  previewTitle.textContent = fighter.label;
  previewImg.src = fighter.image;
  previewImg.alt = fighter.label;
  refreshPreview();
  backgroundEls.forEach((el) => el && (el.inert = true));
  document.body.classList.add('modal-open');
  previewModal.hidden = false;
  (previewSelect.disabled ? previewClose : previewSelect).focus();
}

function closePreview() {
  previewModal.hidden = true;
  backgroundEls.forEach((el) => el && (el.inert = false));
  document.body.classList.remove('modal-open');
  updateFloatFight();
  if (previewOpener && document.contains(previewOpener)) previewOpener.focus({ preventScroll: true });
  previewImage = null;
  previewOpener = null;
}

previewClose.addEventListener('click', closePreview);
previewSelect.addEventListener('click', () => {
  if (previewImage) toggleSelect(previewImage); // same logic as clicking the card
  closePreview();
});
previewModal.addEventListener('click', (e) => {
  if (e.target === previewModal) closePreview();
});
previewModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePreview();
  } else if (e.key === 'Tab') {
    const items = [previewClose, previewSelect].filter((el) => !el.disabled);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

function renderDex() {
  const list = loadDex();
  const grid = document.getElementById('dex-grid');
  grid.replaceChildren();
  // Stored order is oldest-first; display newest-first without touching storage.
  for (let index = list.length - 1; index >= 0; index--) {
    const fighter = list[index];
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.image = fighter.image;
    card.dataset.label = fighter.label;

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
    del.addEventListener('click', (e) => {
      e.stopPropagation(); // deleting must not toggle selection
      const next = loadDex();
      next.splice(index, 1);
      saveDex(next);
      selected.delete(fighter.image);
      if (next.length === 0) {
        location.href = 'index.html#new'; // last fighter gone: show the entry screen
        return;
      }
      renderDex();
    });

    top.append(no, del);

    // The whole picture + name area is one real button, so keyboard and touch work natively.
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'card-select';
    pick.setAttribute('aria-pressed', 'false');
    pick.setAttribute('aria-label', `Select ${fighter.label}`);
    pick.addEventListener('click', () => {
      guarded(() => BGMotion.awaken(card)); // deliberate click/tap, no hover needed
      toggleSelect(fighter.image);
    });
    // Mouse hover only: touch and pen go through the click above.
    card.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') guarded(() => BGMotion.awaken(card));
    });

    const embers = document.createElement('span');
    embers.className = 'card-embers';
    embers.setAttribute('aria-hidden', 'true');
    for (let n = 0; n < 6; n++) embers.append(document.createElement('i'));

    const img = document.createElement('img');
    img.src = fighter.image;
    img.alt = '';

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = fighter.label;

    pick.append(img, name);

    // Preview opens a larger view with a Select action (shown only when search is active).
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'card-preview';
    preview.setAttribute('aria-label', `Preview ${fighter.label}`);
    preview.append(makeIcon('zoom-in'));
    preview.addEventListener('click', () => openPreview(fighter, preview));

    card.append(top, pick, preview, embers);
    grid.append(card);
  }

  const n = list.length;
  document.getElementById('dex-empty').hidden = n > 0;
  document.getElementById('dex-clear').hidden = n === 0;
  applyFilter(); // search box visibility, active filter and the count text
  updateActionButton(list);
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
  selected.clear();
  confirmBox.hidden = true;
  location.href = 'index.html#new'; // nothing left: show the entry screen
});

renderDex();
