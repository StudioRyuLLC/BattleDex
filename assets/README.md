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
| Combat sound effects (Stages 9.3 and 9.4) | 38 Pixabay MP3s in `audio/` (flat, next to `music/`): 32 from 9.3 plus the 6 below; 1 more file is present but unused (see "Stage 9.4 inventory"). Clip windows and the cue-to-file mapping live in `COMBAT_SOUNDS` / `COMBAT_AMBIENCE` in `audio.js` | Pixabay Content License. Creator = the Pixabay user name that starts each file name (no embedded tags), credited in `SFX_CREDITS` in `guide.js`. Unverified: the exact creator names, profile links and license wording still need confirming on Pixabay |
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

### Stage 9.4 inventory (verified on disk, original file names kept)
| File (in `audio/`) | Length | Used as | Window(s) / level |
|---|---|---|---|
| `goodsoupdisciple-witch-cackle-250272.mp3` | 7.9 s | `voice.cackle` (witch) | two cackles: 0.3 s +1.9 s, 4.05 s +1.8 s; gain 3 (very quiet source) |
| `alesiadavina-evil-witch-cackle-laugh-dark-female-laughter-sfx-553614.mp3` | 2.8 s | `voice.cackle_evil` ("evil/dark/wicked witch or sorceress") | whole file; gain 1.4 |
| `freesound_community-ambientgunfire-24696.mp3` | 140 s | `ambience.gunfire` bed (modern military fighters) | steady stretch 40 s +30 s, looped with 30 ms edge fades; gain 0.4 |
| `freesound_community-artillery-gunfire-14607.mp3` | 7 s | `explosion.artillery` (loud, rare) | three booms: 0 s +2.6 s, 3.1 s +1.65 s, 5.15 s +1.4 s; gain 0.65 |
| `mikst656-lasergun-152375.mp3` | 1.3 s | `energy_weapon.laser` | whole file; gain 0.55 |
| `guywiththegoodsounds-swashbuckling-pirates-463695.mp3` | 6.1 s | `voice.pirate` | four bursts cut at the quiet gaps: 0.5 s +0.8, 1.35 s +1.0, 3.05 s +0.75, 3.9 s +1.7; gain 1.2-1.8 |

Gains come from measuring each window's RMS against existing clips. Slow effects rest longer: both
cackle files share a 9 s cooldown, artillery 6.5 s, pirate shouts 3.5 s (others keep 450 ms).
Rules: witch words give cackles (an "evil/dark/wicked" witch or sorceress favors the evil one); a bare
"sorceress" or any female fighter never does. Not auditioned by ear (windows were found from the
waveform, so confirm by listening, especially the pirate file whose content type is unverified).
`freesound_community-witch-laugh-28961.mp3` (25.8 s) is on disk but was not in the Stage 9.4 list, so it is
not used or credited; delete it or tell me to map it.
