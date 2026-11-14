// Fantasy interpretation rules, shared by the judge prompt and the image
// prompt so both always read a fighter the same way (no extra AI call).
// Plain text, so it can be embedded in either prompt.

const FIGHTER_INTERPRETATION = `Battleground is a fantasy battle simulator. Interpret each fighter by these rules, identically for both sides:
- Ordinary animals (cow, rabbit, dog, cat, horse, etc.): treat each as a GIANT, fantastical version of that animal, keeping its recognizable look and traits (a "cow" is a giant fantasy cow, a "rabbit" a giant fantasy rabbit). Keep any quantity or description the user gave ("10 cows" is ten giant fantasy cows; "a tiny rabbit" stays described as tiny-but-fantastical, not a plain rabbit).
- Ordinary humans (a man, a woman, a soldier, a martial artist, Navy SEALs, Delta Force operators, a squad of soldiers): stay realistic humans. Do NOT enhance them. Use only their real-world strength, training, equipment and limits. Give no supernatural strength, magic, or fantastical gear unless the user explicitly asks for it in the fighter text.
- Fighters that are already mythical, fantastical, cryptid, supernatural or fictional (dragon, elf, Bigfoot, a named hero): keep their established lore and traits. Do not transform or upgrade them further.
- Historical figures, public figures and recognizable fictional characters: judge them by their documented skills, reputation and established lore, with no invented powers unless the user asks for them.
- Always preserve explicit numbers of combatants.`;

// Visual-only version for the image prompt (no judging language).
const IMAGE_INTERPRETATION =
  "Draw ordinary animals (cow, rabbit, dog, etc.) as giant, powerful, fantastical versions of that animal that keep their recognizable look. " +
  "Draw ordinary humans, soldiers, martial artists and military units as realistic humans with realistic gear and no supernatural effects, glowing auras, or fantasy armor. " +
  "Draw mythical, fantastical and fictional beings and characters with their usual established look. Draw historical or public figures as recognizable, dignified, clearly stylized comic-art portraits in period-appropriate, heroic or fantasy battle attire. " +
  "Keep any quantity the subject states.";

// PG-13 fantasy-action standard. Prompt instructions are a safeguard, not a
// guarantee: provider moderation and the safe-failure paths in fight.js stay on.
const JUDGE_CONTENT_STANDARDS = `Battleground is PG-13 fantasy action in the spirit of a Saturday-morning-to-summer-blockbuster comic book. Intense fantasy combat, defeat, and even death are allowed, told in a dramatic, entertaining, comic-book voice. Never describe graphic injuries, gore, dismemberment, exposed organs, mutilation, torture, or sexual content or sexual violence, and never sexualize anyone, especially minors. Keep defeats non-graphic: knocked out, outmatched, banished, overwhelmed, vanquished, "lights out". This applies equally to every fighter type and matchup.`;

const IMAGE_CONTENT_STANDARDS =
  "Content standard: strict PG-13, an adventurous, cinematic fantasy-action look. " +
  "Every character is fully clothed in appropriate fantasy, historical, futuristic or combat attire. " +
  "Never show nudity, sexual or suggestive content, or anything that sexualizes a minor. " +
  "Never show hateful, degrading or sexually exploitative imagery. " +
  "Never show a real person in a compromising, humiliating or misleading situation; real people appear only as dignified, clearly stylized heroic illustrations, never photorealistic. " +
  "Non-graphic action is welcome: weapons, armor, dramatic poses, battle scars, torn clothing, dust, scuffs and moderate battle damage. " +
  "Show no graphic gore, no dismemberment, no exposed organs, no pools of blood, no torture and no extreme bodily injury. " +
  "Apply this to every subject, including creatures, robots, aliens and groups.";

module.exports = { FIGHTER_INTERPRETATION, IMAGE_INTERPRETATION, JUDGE_CONTENT_STANDARDS, IMAGE_CONTENT_STANDARDS };
