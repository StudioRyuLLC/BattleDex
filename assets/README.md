# Battleground media assets (Stage 8)

## Audio: no third-party files
All music, combat effects, the victory fanfare and the ambience are **synthesized at runtime**
by `audio.js` using the Web Audio API (oscillators, filtered noise, envelopes). They are original
to this project, so there are no audio files to license, host or optimize.

| Sound | Source | License |
|---|---|---|
| Home / BattleDex ambience ("The Gathering Storm") | synthesized in `audio.js` | original, project-owned |
| Battle music ("Clash of Champions") | synthesized in `audio.js` | original, project-owned |
| Victory fanfare ("The Champion Rises") | synthesized in `audio.js` | original, project-owned |
| Sword clash / strike / heavy impact / crowd ambience | synthesized in `audio.js` | original, project-owned |
| Spoken announcements | browser Web Speech API (`speechSynthesis`) | no assets, no paid TTS |

## Animated fighters
`animations/manifest.json` maps a normalized fighter name (lowercase, punctuation removed, leading
"a/an/the" dropped) to an animated WebP/GIF/MP4/WebM in `animations/`:

```json
{ "enabled": true, "animations": { "red dragon": "red-dragon.webp" } }
```

No animated assets ship in Stage 8; the manifest is empty, so "Animated Fighter" falls back to the
cinematic CSS effects. Set `"enabled": false` (or delete the manifest) to switch the feature off.
Prefer animated WebP or MP4/WebM over GIF for size. Record the source and license of every asset here.

## Starter fighters (Stage 8.8)
`starters/navy-seals.webp` ("A Squad of Navy SEALs") and `starters/red-dragon.webp` ("A Red Dragon"),
both 512x512 WebP, are the two fighters a first-time player finds in the BattleDex. They are original
Battleground comic-style portraits produced earlier with this project's own image prompt (OpenAI image
API, project-owned output), resized to 512px. No third-party art, nothing generated at runtime.
Records are `{ label, image }` like every BattleDex entry; the image path is the unique id.
Seeding rules and the reason an empty stored list counts as "no data": `startup.js`.
