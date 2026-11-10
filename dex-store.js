// Storage shared by index.html and battledex.html.
// BattleDex = localStorage array of { label, image } (no fight data).
// Recent fight = sessionStorage, so the BattleDex page can link back to it.
const DEX_KEY = 'battledex';
const RECENT_KEY = 'battleground-recent-fight';

function loadDex() {
  try {
    const list = JSON.parse(localStorage.getItem(DEX_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Returns false if the write failed (e.g. storage quota full).
function saveDex(list) {
  try {
    localStorage.setItem(DEX_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function loadRecentFight() {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_KEY));
  } catch {
    return null;
  }
}

function saveRecentFight(fight) {
  try {
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(fight));
  } catch {
    // Too big or storage blocked: "Back to recent fight" just won't appear.
  }
}
