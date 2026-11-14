// Stage 9.3.1: the server no longer deals with sound at all. Mocked: no network, no paid calls.
// Run: npm test
const Module = require('module');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
let mockParsed = null, calls = [];
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '@anthropic-ai/sdk') {
    return class Anthropic {
      constructor() { this.messages = { parse: async (args) => { calls.push(args); return { stop_reason: 'end_turn', parsed_output: mockParsed }; } }; }
    };
  }
  return origLoad.call(this, req, parent, ...rest);
};
const fight = require(path.join(ROOT, 'api/fight.js'));
const { JUDGE_SYSTEM_PROMPT } = require(path.join(ROOT, 'api/judge-prompt.js'));
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'AAAA' }] }) });

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
let ipn = 0;
async function call() {
  const req = { method: 'POST', headers: { 'x-forwarded-for': '10.2.0.' + ++ipn }, body: { fighterA: 'A samurai', fighterB: 'A robot' } };
  const out = { status: 0, body: null };
  await fight(req, { setHeader() {}, status(c) { out.status = c; return this; }, json(o) { out.body = o; return this; } });
  return out;
}

(async () => {
  ok(!/Sound cues|audioEvents|weapon_swing/.test(JUDGE_SYSTEM_PROMPT), 'judge prompt no longer asks for sound cues');
  ok(!fs.existsSync(path.join(ROOT, 'combat-events.js')), 'obsolete combat-events.js is gone');
  for (const f of ['api/fight.js', 'api/judge-prompt.js', 'script.js', 'audio.js', 'index.html', 'battledex.html'])
    ok(!/audioEvents|combat-events|playCombat/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `no narrative-audio code left in ${f}`);

  mockParsed = { winner: 'B', reasoning: 'The robot wins. Circuits beat steel.' };
  let r = await call();
  ok(r.status === 200 && r.body.winner === 'A robot' && r.body.winnerSide === 'B' && r.body.reasoning === mockParsed.reasoning, 'verdict, winner and reasoning unchanged');
  ok(!('audioEvents' in r.body), 'response carries no audioEvents');
  ok(Object.keys(r.body).sort().join() === 'imageA,imageB,reasoning,winner,winnerSide', 'response shape is exactly the pre-9.3 shape');
  mockParsed = { winner: 'A', reasoning: 'Flair.', audioEvents: [{ type: 'gunfire', subtype: 'auto', sentence: 1 }] };
  r = await call();
  ok(r.status === 200 && !('audioEvents' in r.body), 'a stray audioEvents field from the model is never forwarded');
  ok(calls.length === 2, 'one Anthropic request per fight (no extra AI request)');
  const props = JSON.stringify(calls[0].output_config.format);
  ok(!/audioEvents/.test(props) && /winner/.test(props) && /reasoning/.test(props), 'structured output schema is only winner + reasoning');

  console.log(`\n${n - fails}/${n} passed`);
  process.exit(fails ? 1 : 0);
})();
