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

// Fighters picked on the BattleDex page, handed to index.html (#fight) so it
// can start a normal fight without retyping names. Read once, then cleared.
const PENDING_KEY = 'battleground-pending-fight';

function savePendingFight(fighterA, fighterB) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ fighterA, fighterB }));
    return true;
  } catch {
    return false;
  }
}

function takePendingFight() {
  try {
    const f = JSON.parse(sessionStorage.getItem(PENDING_KEY));
    sessionStorage.removeItem(PENDING_KEY);
    return f && f.fighterA ? f : null; // fighterB is empty for a single-fighter challenge
  } catch {
    return null;
  }
}

// --- Image compression (Stage 5) ---
// Fighter art arrives as ~260 KB 1024px JPEG data URIs; localStorage holds
// ~5 MB total. Redraw onto an off-screen canvas at thumbnail size and
// re-export as WebP (JPEG fallback) so each saved fighter is a few KB.
const THUMB_MAX_SIDE = 320;
const THUMB_QUALITY = 0.7;
const compressCache = new Map(); // original data URI -> Promise<compressed>

function compressImage(src) {
  if (!compressCache.has(src)) {
    compressCache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          let out = canvas.toDataURL('image/webp', THUMB_QUALITY);
          // Browsers without WebP encoding silently return PNG.
          if (!out.startsWith('data:image/webp')) {
            out = canvas.toDataURL('image/jpeg', THUMB_QUALITY);
          }
          resolve(out);
        };
        img.onerror = () => reject(new Error('Could not load image to compress'));
        img.src = src;
      })
    );
  }
  return compressCache.get(src);
}

// Build an inline SVG icon that references the sprite in the page markup.
function makeIcon(id) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}
