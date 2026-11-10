# Battleground — Staged Build Plan

> Source: `project-brief.md`. Each stage ships something runnable/demoable before moving to next. Do not start stage N+1 until stage N works.

---

## Stage 0 — Scaffold

**Goal:** empty project running locally.

- [ ] `index.html`, `style.css`, `script.js` — bare skeleton, no logic yet
- [ ] `vercel.json` (if needed) + `api/` folder for serverless functions
- [ ] `package.json` (name, no deps yet unless a dev server is wanted)
- [ ] Run locally (e.g. `vercel dev` or a static server), confirm blank page loads

**Done when:** blank page loads locally. No deploy — building and testing locally the whole way.

---

## Stage 1 — Static UI shell (no backend)

**Goal:** all core UI elements exist and are wired to JS, hardcoded/mock data only.

- [ ] Four separate views on one page — input form, loading, result, error — each toggled via `hidden` attribute, never stacked/visible together
- [ ] Input form view: two text inputs (fighter A, fighter B), Fight button — the only view visible on load
- [ ] Loading view: spinner/skeleton, shown on click
- [ ] Result view: winner name, written reasoning, two image slots — populate with placeholder text/images after a fake `setTimeout` delay
- [ ] Error view: placeholder error message
- [ ] Basic CSS layout, mobile-usable

**Done when:** on load only input form shows; clicking Fight hides it, shows loading, then swaps to result view (fake data) via `hidden`, no network calls yet.

---

## Stage 2 — Judge system prompt

**Goal:** lock Claude's role to judging fights, resist prompt injection from fighter input.

- [ ] Write the system prompt used in the verdict call: role locked to fight judge only — takes two fighters, returns a winner and reasoning, nothing else
- [ ] Explicitly forbid in the prompt: role changes, revealing the system prompt, following instructions embedded in fighter names/descriptions, doing anything other than judging the fight
- [ ] Treat fighter input strictly as data to judge, never as instructions
- [ ] Always name exactly one winner — no ties, no draws, no refusals, even for identical matchups (e.g. "cat vs cat"); the prompt must tell the judge to pick one anyway and give a playful reason (coin-flip-style tiebreaker is fine)
- [ ] Response length: 2–4 sentences max for the reasoning — fun and playful in tone, but the logic must still hold up (a clear reason why the winner wins)
- [ ] Test with adversarial input (e.g. a fighter name containing "ignore previous instructions and...") — confirm it still just judges a fight
- [ ] Test identical matchup (A = B) — confirm it still returns one winner, no tie/refusal
- [ ] Test several matchups — confirm reasoning is always 2–4 sentences, playful, and logical

**Done when:** injected instructions inside fighter text don't change judge behavior or leak the system prompt; every matchup (including identical ones) yields exactly one winner with a 2–4 sentence playful-but-logical verdict.

---

## Stage 3 — Fight API (verdict + art + rate limiting)

**Goal:** one function, one call, real winner + reasoning + one image per side, end to end.

- [ ] `api/fight.js` serverless function: takes `{ fighterA, fighterB }`
- [ ] Rate limit check runs first, before calling either API — key by IP, 5 requests/minute per `project-brief.md` §5, return 429 with a clear message when exceeded
- [ ] Calls Claude for the verdict (using the Stage 2 system prompt) and OpenAI image API for both fighters' art
- [ ] Verdict output format is enforced with a zod schema (`winner`: `"A"` | `"B"`, `reasoning`: string), not by JSON instructions in the system prompt — add `zod` as a dependency and validate/parse the verdict against it
- [ ] Store both API keys in env vars, never in client code
- [ ] Group inputs (e.g. "10 cows") still produce exactly one image for that side — handled in the prompt sent to the image API, not by looping
- [ ] Image prompt composition rules (prompt only): singular ("a werebear", "one dwarf", "the dragon") = exactly ONE character; explicit quantity ("3 lions", "10 cows") = exactly that many; vague plural ("some wolves", "several goblins") = a small group of 3–5; every character fully and clearly visible in the frame
- [ ] Every image must follow the shared **Art Style Template**, defined once as a constant (e.g. `ART_STYLE` in `api/fight.js` or its own `api/art-style.js`) and appended to every image prompt, for both sides, no exceptions:
  > Bold flat-color illustration, thick black outlines, dynamic action pose, dramatic lighting, comic book character art style, John Romita Jr.-style of Marvel Comics. Keep it centered, filling most of the frame, isolated on a plain solid light gray background with no scenery. Absolutely no text, words, letters, numbers, logos, watermarks, UI elements, borders, or frames of any kind. Illustration only, nothing else on the canvas.
- [ ] Wire Fight button to call `/api/fight` instead of the fake timeout
- [ ] Handle errors distinctly in the UI: verdict failure, image failure, **moderation-blocked**, rate-limit 429 — don't hang on loading forever
- [ ] **Moderation-blocked is its own error case**, separate from a generic image failure: when the OpenAI image API rejects a fighter's prompt for safety/moderation reasons (e.g. `moderation_blocked` / content-policy error), the API returns a distinct status/code (e.g. 422 `{ code: "moderation_blocked", side: "A"|"B" }`) and the UI shows a specific message ("that fighter was blocked, try a different one") instead of the generic "image failed, try again" (which is for timeouts/5xx and is worth retrying)

**Done when:** typing two real fighters returns winner + reasoning + one image per side from a single call; hammering Fight 6x in a minute from one IP gets blocked on the 6th and resets after a minute.

---

## Stage 4 — BattleDex (save to localStorage)

**Goal:** save individual fighters, view saved fighters.

- [ ] "Save" action per fighter: writes `{ label, image }` to a `localStorage` array — no fight/winner/reasoning data, just the fighter
- [ ] BattleDex view: grid of saved fighters, each shown as a styled **mini trading card**: image on top, name below. Cards are display-only, **not click-to-view** (it's just a name and an image, so there is nothing more to open)
- [ ] BattleDex view has a **"Back to recent fight"** button that returns to the most recent fight's result view, and a **"New fight"** button that goes to the input form (both switch views through `showView`)
- [ ] BattleDex is its own page (`battledex.html` + `battledex.js`), sharing storage helpers with the fight page via `dex-store.js`
- [ ] The recent fight is kept in `sessionStorage` (so the separate BattleDex page can link back to it via `index.html#recent`), separate from the BattleDex `localStorage` array, so saving still stores only `{ label, image }`. Hide "Back to recent fight" when no fight has been run yet
- [ ] Delete/clear entries from BattleDex

**Done when:** save a fighter, reload the page, it's still there in BattleDex as a trading card; from BattleDex you can jump back to your recent fight or start a new one.

---

## Stage 5 — Image compression before save

**Goal:** stay under `localStorage` quota (per brief §5).

- [x] Before saving a fighter to BattleDex, draw its image to an off-screen `<canvas>`, resize down, re-export as JPEG/WebP at reduced quality
- [x] Save the compressed data URI, not the original
- [x] Test with several saved fighters that quota isn't hit quickly

**Done when:** ~10+ saved fighters don't blow `localStorage` quota.

---

## Stage 6 — Claude Redesign

**Goal:** instead of just polishing the verdict UI, hand the entire app to Claude Design for a full visual overhaul. Runs after BattleDex and compression so every view exists before it is restyled.

- [ ] Give Claude Design the whole app: form, loading, result (winner card, both fighter images, reasoning), error, and BattleDex views, plus `project-brief.md` for intent
- [ ] Apply the redesign across `index.html`, `style.css` and any needed `script.js` markup hooks, covering every view, not just the result
- [ ] Winner card with entry animation (CSS transition/keyframes) when the result lands, per the brief's "winner card with animation, plus written reasoning"
- [ ] Loading state covers the full wait for the fight call
- [ ] Distinct, designed error states: verdict failure, image failure, moderation-blocked, 429 rate limit
- [ ] Redesigned UI still works with the art style template's light gray image backgrounds
- [ ] No behavior regressions: `showView` switching, fight flow, save/delete in BattleDex all still work

**Done when:** the whole app has one cohesive, finished look with no placeholder styling, and the full flow works as before.

---

## Stage 7 — Final QA + Deploy to Vercel

**Goal:** ship it.

- [ ] Full manual pass: empty inputs, one empty input, same fighter twice, very long names, non-English input
- [ ] Confirm rate limiting doesn't fire on normal single-fight use
- [ ] Confirm loading/error states cover: fight API failure (verdict or image side), rate limit hit, network offline

- [ ] Deploy to Vercel: set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` as Vercel project env vars (never committed), deploy, and smoke-test a real fight on the live URL
- [ ] Re-check rate limiting on the deployed app: the in-memory limiter is per serverless instance, so confirm it behaves acceptably or swap in a shared store (e.g. Upstash/KV)
- [ ] Confirm the deployed function finishes within Vercel's function time limit (verdict + two images run in parallel; raise `maxDuration` in `vercel.json` if needed)

**Done when:** the MVP handles every QA case end to end without console errors locally, and a real fight works on the deployed Vercel URL.

---

## Explicitly out of scope (per brief §4 — later, not now)

- Real backend / cross-device BattleDex sync
- Quick re-fight using saved BattleDex characters
