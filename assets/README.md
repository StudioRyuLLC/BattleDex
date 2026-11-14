# Battleground media assets (Stage 8, updated Stage 9.1)

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
