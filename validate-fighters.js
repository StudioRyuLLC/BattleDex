// Matchup validation shared by the browser (index/battledex pages) and
// api/fight.js, so the client check and the server check cannot drift apart.
// Layer 1 of 2 for protected characters: a deterministic list of famous
// franchise characters. Layer 2 is the judge's `protected_side` flag (same
// Claude call, no extra request) for everything this list cannot know.
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

  // Patterns run on the normalized name. Multi-word / unmistakable names only,
  // so ordinary words and names ("Barney", "Mario the baker", Thor, Dracula,
  // Robin Hood, Sherlock Holmes) are never rejected by this list.
  const PROTECTED_PATTERNS = [
    /\bbarney (the|and|&) (purple )?(dinosaur|friends)\b/, /\bpurple dinosaur barney\b/,
    /\bmickey mouse\b/, /\bminnie mouse\b/, /\bdonald duck\b/, /\bgoofy dog\b/,
    /\bwinnie the pooh\b/, /\bbugs bunny\b/, /\bdaffy duck\b/, /\bspongebob\b/, /\bpatrick star\b/,
    /\bpikachu\b/, /\bcharizard\b/, /\bpokemon\b/, /\bsuper mario\b/, /\bsonic the hedgehog\b/,
    /\bspider ?man\b/, /\bbat ?man\b/, /\bsuper ?man\b/, /\bwonder woman\b/, /\biron man\b/,
    /\bcaptain america\b/, /\bthe hulk\b/, /\bincredible hulk\b/, /\bwolverine\b.*\bx men\b/,
    /\bdarth vader\b/, /\bluke skywalker\b/, /\byoda\b/, /\bmandalorian\b/, /\bstormtrooper\b/,
    /\bharry potter\b/, /\bhermione granger\b/, /\blord voldemort\b/, /\bgoku\b/, /\bnaruto uzumaki\b/,
    /\bhello kitty\b/, /\bshrek\b/, /\belsa\b.*\bfrozen\b/, /\bsimba\b.*\blion king\b/,
    /\bscooby doo\b/, /\bhomer simpson\b/, /\bpeppa pig\b/, /\bkermit the frog\b/, /\bgodzilla\b/,
  ];

  function isProtectedName(value) {
    const n = normalizeName(value);
    return PROTECTED_PATTERNS.some((re) => re.test(n));
  }

  const MESSAGES = {
    identical:
      'Hold, herald! A champion cannot duel their own reflection. Name two DIFFERENT challengers and sound the horn again!',
    protectedFighter: (name) =>
      `Halt! "${name}" is a famed hero of a protected tale, and the arena does not admit recognizable franchise characters. Bring a dragon, a legend, or a champion of thine own making!`,
    protectedGeneric:
      'Halt! One of these challengers is a famed hero of a protected tale, and the arena does not admit recognizable franchise characters. Bring a dragon, a legend, or a champion of thine own making!',
  };

  // Returns { ok: true } or { ok: false, code: 'invalid_matchup', reason, message }.
  function validateMatchup(a, b) {
    if (normalizeName(a) && normalizeName(a) === normalizeName(b)) {
      return { ok: false, code: 'invalid_matchup', reason: 'identical', message: MESSAGES.identical };
    }
    for (const name of [a, b]) {
      if (isProtectedName(name)) {
        return {
          ok: false,
          code: 'invalid_matchup',
          reason: 'protected',
          message: MESSAGES.protectedFighter(name),
        };
      }
    }
    return { ok: true };
  }

  // True if a BattleDex list already holds this fighter name (normalized).
  function isNameSaved(dex, label) {
    const n = normalizeName(label);
    return !!n && dex.some((f) => normalizeName(f.label) === n);
  }

  return { normalizeName, isProtectedName, validateMatchup, isNameSaved, PROTECTED_MESSAGE: MESSAGES.protectedGeneric };
});
