// Stage 9.2 fighter-policy regression tests. Run: npm test
// Everything is mocked (Anthropic SDK and fetch), so there is no network and no paid API call.
const Module = require('module');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let anthropicCalls = [];
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@anthropic-ai/sdk') {
    return class Anthropic {
      constructor() { this.messages = { parse: async (args) => { anthropicCalls.push(args); return { stop_reason: 'end_turn', parsed_output: { winner: 'A', reasoning: 'A wins by sheer flair.' } }; } }; }
    };
  }
  return origLoad.call(this, req, parent, ...rest);
};
const fight = require(path.join(ROOT, 'api/fight.js'));
const { validateMatchup } = require(path.join(ROOT, 'validate-fighters.js'));
const { buildImagePrompt } = require(path.join(ROOT, 'api/art-style.js'));
const { JUDGE_SYSTEM_PROMPT } = require(path.join(ROOT, 'api/judge-prompt.js'));

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

let imagePrompts = [], blockedNames = new Set();
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  imagePrompts.push(body.prompt);
  const subject = body.prompt.match(/of: "(.*?)"\. /)[1];
  if (blockedNames.has(subject)) return { ok: false, status: 400, json: async () => ({ error: { code: 'moderation_blocked', message: 'safety' } }) };
  return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'AAAA' }] }) };
};

let ipn = 0;
async function call(a, b) {
  const req = { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.' + ++ipn }, body: { fighterA: a, fighterB: b } };
  let out = { status: 0, body: null };
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(o) { out.body = o; return this; } };
  await fight(req, res);
  return out;
}

(async () => {
  // Validation: only identical matchups are rejected now
  for (const [a, b] of [['Spider-Man', 'Batman'], ['Darth Vader', 'Yoda'], ['Pikachu', 'Godzilla'], ['Marvel Thor', 'Harry Potter'], ['Napoleon Bonaparte', 'Joan of Arc']])
    ok(validateMatchup(a, b).ok, `validation allows "${a}" vs "${b}"`);
  ok(!validateMatchup('a cat', 'The Cat').ok, 'validation still rejects identical fighters');

  // Prompts
  const PG = ['no nudity'.replace('no nudity', 'nudity'), 'sexualizes a minor', 'graphic gore', 'dismemberment', 'exposed organs', 'moderate battle damage', 'hateful', 'compromising', 'PG-13'];
  const sample = buildImagePrompt('Cleopatra');
  PG.forEach((k) => ok(sample.includes(k), `image prompt carries PG-13 clause: ${k}`));
  ok(buildImagePrompt('Thor').includes('"Thor"') && !/Poetic Edda|Prose Edda/.test(buildImagePrompt('Thor')), 'no silent substitution: "Thor" is drawn as named');
  ok(!/protected/i.test(JUDGE_SYSTEM_PROMPT) && !/protected_side/.test(JUDGE_SYSTEM_PROMPT), 'judge prompt has no franchise-protection rule');
  ok(/PG-13/.test(JUDGE_SYSTEM_PROMPT) && /Known characters and real people/.test(JUDGE_SYSTEM_PROMPT), 'judge prompt keeps PG-13 and adds known-characters guidance');

  // Representative concepts end to end (mocked)
  const matchups = [
    ['A stoic elf ranger with twin curved blades', 'A glacier-skinned ogre warlord'],       // original heroes/monsters
    ['Napoleon Bonaparte', 'Joan of Arc'],                                                  // historical
    ['Spider-Man', 'Darth Vader'],                                                          // recognizable fictional
    ['A battle-scarred orc with a cracked shield', 'A dented chrome war robot'], // non-graphic combat
    ['An alien hive queen', 'Anansi the trickster'],
  ];
  for (const [a, b] of matchups) {
    imagePrompts = []; anthropicCalls = [];
    const r = await call(a, b);
    ok(r.status === 200 && r.body.imageA && r.body.imageB && r.body.winner === a, `200 + both portraits: "${a}" vs "${b}"`);
    ok(imagePrompts.length === 2 && imagePrompts[0].includes(`"${a}"`) && imagePrompts[1].includes(`"${b}"`), '  portrait prompts carry both names verbatim (no substitution)');
    ok(anthropicCalls[0].messages[0].content.includes(`<fighter_a>${a}</fighter_a>`), '  judge receives both fighters');
  }

  // Provider refusal -> friendly 422, names preserved, nothing swapped
  blockedNames = new Set(['Spider-Man']);
  imagePrompts = [];
  const blocked = await call('Spider-Man', 'Darth Vader');
  ok(blocked.status === 422 && blocked.body.code === 'moderation_blocked' && blocked.body.side === 'A', 'provider refusal -> 422 moderation_blocked with side A');
  ok(/Spider-Man/.test(blocked.body.error) && /Nothing was swapped/.test(blocked.body.error) && /Reword/.test(blocked.body.error), '  message names the fighter, says nothing was swapped, invites rewording');
  ok(imagePrompts.length === 2, '  no retry with a different subject (2 image requests only)');
  blockedNames = new Set(['Darth Vader']);
  const blockedB = await call('A dragon', 'Darth Vader');
  ok(blockedB.status === 422 && blockedB.body.side === 'B', 'refusal on side B reported as side B');
  blockedNames = new Set();

  // Identical still rejected server side
  const same = await call('cat', 'A Cat');
  ok(same.status === 422 && same.body.code === 'invalid_matchup', 'server rejects identical fighters');

  console.log(`\n${n - fails}/${n} passed`);
  process.exit(fails ? 1 : 0);
})();
