# Battleground media assets (Stage 8, updated Stage 9.1 and 9.3)

## Audio
Background music is three third-party MP3s from Pixabay (`audio/music/`); everything else is
synthesized at runtime by `audio.js` with the Web Audio API, so it is original to this project.
Music credits are shown to players in the How to Play / About guide (`guide.js`, `MUSIC_CREDITS`).
Add any future sound-effect contributor to `SFX_CREDITS` in `guide.js` and to the table below.

| Sound | Source | License / credit |
|---|---|---|
| Home / Entry music | `audio/music/hitslab-warrior-soldier-fighting-music-489236.mp3`, Ievgen Poltavskyi (HitsLab), Pixabay | Pixabay Content License, credited in the guide |
| BattleDex music | `audio/music/yevhenastafiev-epic-epic-battle-607250.mp3`, Yevhen Astafiev, Pixabay | Pixabay Content License, credited in the guide |
| Judging / Victory music | `audio/music/alec_koff-japan-taiko-490663.mp3`, Alec Koff, Pixabay | Pixabay Content License, credited in the guide |
| Victory fanfare | synthesized in `audio.js` | original, project-owned |
| Sword clash / strike / heavy impact / crowd ambience | synthesized in `audio.js` | original, project-owned |
| Combat sound effects (Stage 9.3) | 32 Pixabay MP3s in `audio/` (flat, next to `music/`); clip windows and the cue-to-file mapping live in `COMBAT_SOUNDS` / `COMBAT_AMBIENCE` in `audio.js` | Pixabay Content License. Creator = the Pixabay user name that starts each file name (no embedded tags), credited in `SFX_CREDITS` in `guide.js` |
| Spoken announcements and narration | browser Web Speech API (`speechSynthesis`) | no assets, no paid TTS |

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

## Combat effects (Stage 9.3, metadata-driven since 9.3.1)
While the Judging/Loading screen is up, the two fighters' text (name/description) is classified by
`PALETTE_RULES` in `audio.js` into weighted sound palettes (blades, unarmed, archery, magic, ice,
dragon, beast, robot, sci-fi, firearms, explosives, plus female voice and group flavor; unknown text
falls back to a generic brawl). Effects are scheduled at varied intervals and stop before the verdict
appears. Nothing comes from the AI or the server. The only mapping from a key to a file is
`COMBAT_SOUNDS` (one-shots, cut from the MP3s as { file, start, dur, gain, rate } windows, since several
files are long compilations) and `COMBAT_AMBIENCE` (looped beds) in `audio.js`. To add a sound: put the MP3 in `audio/`, add a clip line,
add the creator to `SFX_CREDITS` in `guide.js`, and add a row above. No archery recordings are present
yet, so `projectile.arrow` reuses pitched-up whoosh clips.
