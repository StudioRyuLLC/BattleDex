// Floating Back-to-top button (arena + BattleDex). Shown after scrolling ~400px.
(function () {
  const SHOW_AFTER = 400;
  const HIDE_BELOW = 300; // small gap so it doesn't flicker around the threshold

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'to-top';
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Back to top');
  btn.append(makeIcon('arrow-up'));
  document.body.append(btn);

  function update() {
    const y = window.scrollY;
    if (btn.hidden && y > SHOW_AFTER) btn.hidden = false;
    else if (!btn.hidden && y < HIDE_BELOW) btn.hidden = true;
  }
  window.addEventListener('scroll', update, { passive: true });
  update();

  btn.addEventListener('click', () => {
    const reduce = BGSettings.motion() === 'none';
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    // The button hides as we reach the top; keep keyboard focus somewhere sensible.
    const home = document.querySelector('.brand');
    if (home) home.focus({ preventScroll: true });
  });
})();
