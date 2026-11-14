// Matchup validation shared by the browser (index/battledex pages) and
// api/fight.js, so the client check and the server check cannot drift apart.
//
// Stage 9.2: the only application-level rule left is "two DIFFERENT fighters". Recognizable
// fictional characters, historical figures, public figures, monsters, robots and so on are all
// welcome. Content safety (PG-13) lives in the judge and image prompts (api/fighter-rules.js),
// and the image provider keeps its own safety system, which fight.js reports clearly.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  // Lowercase, drop punctuation, collapse whitespace, ignore a leading article.
  function normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(a|an|the) /, '');
  }

  const MESSAGES = {
    identical:
      'Hold, herald! A champion cannot duel their own reflection. Name two DIFFERENT challengers and sound the horn again!',
  };

  // Returns { ok: true } or { ok: false, code: 'invalid_matchup', reason, message }.
  function validateMatchup(a, b) {
    if (normalizeName(a) && normalizeName(a) === normalizeName(b)) {
      return { ok: false, code: 'invalid_matchup', reason: 'identical', message: MESSAGES.identical };
    }
    return { ok: true };
  }

  // True if a BattleDex list already holds this fighter name (normalized).
  function isNameSaved(dex, label) {
    const n = normalizeName(label);
    return !!n && dex.some((f) => normalizeName(f.label) === n);
  }

  return { normalizeName, validateMatchup, isNameSaved };
});
