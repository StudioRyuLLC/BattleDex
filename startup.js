// Stage 8.8 startup: starter fighters + "BattleDex first" landing.
// Loaded in <head> (after dex-store.js) so the redirect happens before the page paints.
//
// Seeding rule (idempotent): if the init flag is missing AND the stored BattleDex is missing or an
// empty list, store exactly two bundled starter fighters, then set the flag. If the flag is
// missing but the BattleDex already holds fighters (or unreadable data we must not overwrite), only
// the flag is set. Once the flag exists, starters are never created again, so deleting fighters or
// using Clear All is permanent.
//
// Why "empty list" counts as "no data": before this flag existed, a player who had saved and then
// deleted fighters was left with an empty list ("[]") in localStorage, which is indistinguishable
// from a new player. Treating that as "already initialised" is what made the first-visit
// experience fail on browsers that had been used before (e.g. during development testing).
//
// index.html (the fighter-entry screen) sends players with at least one fighter to the BattleDex
// using location.replace, so there is no extra history entry and no redirect loop: battledex.html
// never redirects, and any link that wants the entry screen carries a hash (#new, #rematch ...).
// Blocked or broken localStorage is tolerated: nothing is seeded and the entry screen shows.
(function () {
  const FLAG = 'battleground-starters-v1';
  // Bundled local artwork (assets/starters/*.webp): no network or paid generation at runtime.
  // Records use the normal BattleDex shape { label, image }; the image path is the unique id.
  const STARTERS = [
    { label: 'A Squad of Navy SEALs', image: 'assets/starters/navy-seals.webp' },
    { label: 'A Red Dragon', image: 'assets/starters/red-dragon.webp' },
  ];

  function storedDexIsEmpty() {
    const raw = localStorage.getItem(DEX_KEY);
    if (raw === null) return true;
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) && list.length === 0;
    } catch {
      return false; // unreadable data: never overwrite it
    }
  }

  function seedStarters() {
    try {
      if (localStorage.getItem(FLAG)) return;
      if (storedDexIsEmpty() && !saveDex(STARTERS.map((s) => ({ ...s })))) return; // write failed: retry next visit
      localStorage.setItem(FLAG, '1');
    } catch {
      // storage unavailable: the entry screen simply shows
    }
  }

  seedStarters();

  const here = document.currentScript;
  if (here && here.dataset.landing === 'battledex' && !location.hash && loadDex().length > 0) {
    location.replace('battledex.html');
  }
})();
