# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Battleground: type two fighters, get an AI verdict on who wins plus one AI-generated image per side. Vanilla HTML/CSS/JS frontend, Vercel serverless functions in `api/`, Claude API for the verdict, OpenAI image API for art, `localStorage` for the BattleDex (saved fighters).

`project-brief.md` is the product spec; `project-build.md` is the staged build plan. Build in stage order and don't start stage N+1 until stage N works. Everything runs locally until the final stage (Stage 7), which deploys to Vercel. Stage order: 3 fight API, 4 BattleDex, 5 image compression, 6 Claude Redesign (full-app visual overhaul via Claude Design), 7 final QA + deploy. Stages 0–1 are done; Stage 2 (judge prompt) is written but its adversarial/identical-matchup tests have not been run. Tick the checkboxes in `project-build.md` as stages complete.

## Commands

- No build, lint, or test tooling exists yet (`npm run build` is just an echo; `vercel.json` only sets `outputDirectory: "."`).
- Run locally: `vercel dev` (needed once `api/fight.js` exists; env vars come from `.env.local`). Until then any static server works, e.g. `npx serve .`.
- Stage 3 adds `zod` as a dependency.

## Architecture

- **Frontend (`index.html`, `style.css`, `script.js`):** one page with four mutually exclusive views (form, loading, result, error). `showView(name)` toggles the `hidden` attribute, so only one is ever visible; always switch views through it. `runFight()` in `script.js` is currently a fake `setTimeout`; Stage 3 replaces it with a `fetch` to `/api/fight`, which must map failures (verdict, image, 429) to `showError` rather than hanging on loading.
- **`api/judge-prompt.js`:** exports `JUDGE_SYSTEM_PROMPT` (CommonJS). Fighters must be passed to Claude wrapped as `<fighter_a>…</fighter_a>` and `<fighter_b>…</fighter_b>`; the prompt treats everything inside those tags as data, never instructions (prompt-injection defense). It has no JSON-format instruction on purpose: the output shape (`winner`: `"A"` | `"B"`, `reasoning`: string) is to be enforced by a zod schema in `api/fight.js`. Winner is `"A"`/`"B"`, not a name, so identical matchups ("cat" vs "cat") stay unambiguous.
- **Judge rules baked into the prompt:** always exactly one winner (no ties/refusals, even for identical fighters); reasoning is 2–4 sentences, playful but logical.
- **Planned `api/fight.js`:** takes `{ fighterA, fighterB }`; rate limit (5 req/min per IP, 429 on exceed) runs first, before any API call; then one Claude verdict call plus one OpenAI image per side (a group like "10 cows" is still one image, handled in the image prompt, not by looping). Every image prompt must include the shared Art Style Template (defined in `project-build.md` Stage 3, kept as a single constant). API keys live in env vars only.
- **Error cases:** `api/fight.js` and `showError` distinguish verdict failure, generic image failure, moderation-blocked (OpenAI safety rejection, not worth retrying), and 429.
- **BattleDex (Stages 4–5, planned):** saves only `{ label, image }` per fighter, not fight results. Images are downsized and recompressed via an off-screen canvas (JPEG/WebP) before saving to stay under the `localStorage` quota.
