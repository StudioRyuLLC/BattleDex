// Stage 8 Animation Manager: victory animation, BattleDex card "awakening", fallbacks.
// Effective mode comes from BGSettings.motion():
//   'animated' -> character-specific asset when one exists, otherwise the CSS effects
//   'css'      -> CSS/Web-animation effects on the existing artwork
//   'none'     -> static artwork (a global CSS rule also freezes the older decorative motion)
// Nothing here can fail a battle: every path is wrapped and falls back to static art.
const BGMotion = (function () {
  const AWAKE_MS = 1100;
  let victoryToken = 0;

  const mode = () => BGSettings.motion();

  function clearVictory() {
    document.querySelectorAll('.victory-fx').forEach((el) => el.classList.remove('victory-fx'));
    document.querySelectorAll('.victory-anim, .victory-sparks').forEach((el) => el.remove());
  }

  function addSparks(stage) {
    const sparks = document.createElement('span');
    sparks.className = 'victory-sparks';
    sparks.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 9; i++) sparks.append(document.createElement('i'));
    stage.append(sparks);
  }

  // Overlay a character-specific animated asset on the winner's frame. Any error removes it.
  function showAsset(frame, asset, token) {
    const el = document.createElement(asset.kind === 'video' ? 'video' : 'img');
    el.className = 'victory-anim';
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    const fail = () => el.remove();
    const ready = () => {
      if (token === victoryToken) el.hidden = false;
      else el.remove();
    };
    if (asset.kind === 'video') {
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.autoplay = true;
      el.addEventListener('loadeddata', ready);
    } else {
      el.alt = '';
      el.addEventListener('load', ready);
    }
    el.addEventListener('error', fail);
    el.src = asset.url;
    frame.append(el);
  }

  // side: 'A' | 'B' (winner). Runs after the verdict is already on screen.
  function playVictory(side, winnerName) {
    clearVictory();
    const token = ++victoryToken;
    const m = mode();
    if (m === 'none' || !side) return;
    try {
      const fig = document.getElementById(side === 'A' ? 'fig-a' : 'fig-b');
      const stage = fig.querySelector('.stage');
      const frame = fig.querySelector('.frame');
      void fig.offsetWidth; // restart the CSS animation on repeat battles
      fig.classList.add('victory-fx');
      addSparks(stage);
      if (m === 'animated' && typeof BGMedia !== 'undefined') {
        BGMedia.getAnimation(winnerName).then((asset) => {
          if (asset && token === victoryToken) showAsset(frame, asset, token);
        });
      }
    } catch {
      // static artwork stays visible
    }
  }

  // BattleDex: brief "awakening" on deliberate hover/tap. Cooldown prevents repeats.
  function awaken(card) {
    if (mode() === 'none' || card.classList.contains('is-awake')) return;
    card.classList.add('is-awake');
    setTimeout(() => card.classList.remove('is-awake'), AWAKE_MS);
  }

  return { mode, playVictory, clearVictory, awaken };
})();
