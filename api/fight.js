// POST /api/fight  { fighterA, fighterB }
// Stage 3: rate limit -> Claude verdict (zod structured output) + one OpenAI
// image per side, in parallel.

const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");
const { JUDGE_SYSTEM_PROMPT } = require("./judge-prompt");

const { buildImagePrompt } = require("./art-style");
const { validateMatchup, PROTECTED_MESSAGE } = require("../validate-fighters");

const MODEL = "claude-sonnet-5-5";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const MAX_NAME_LENGTH = 50;

// Output shape enforced via native structured outputs + zod.
const VerdictSchema = z.object({
  winner: z.enum(["A", "B"]),
  reasoning: z.string(),
  // Safeguard for protected franchise characters the deterministic list cannot know.
  // Piggybacks on the verdict call: no extra paid request.
  protected_side: z.enum(["none", "A", "B", "both"]),
});

// --- Rate limiting: 5 requests/minute per IP (project-brief.md §5) ---
// In-memory sliding window. Fine for local `vercel dev`; on deployed
// serverless it is per-instance, so swap for a shared store (e.g. Upstash/KV)
// if this ever ships.
const RATE_LIMIT = 5;
const WINDOW_MS = 60_000;
const hits = new Map(); // ip -> array of request timestamps

function checkRateLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return { limited: true, retryAfter: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  return { limited: false };
}

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Fighter text goes inside <fighter_*> tags; strip angle brackets so input
// can't close the tag and smuggle in instructions outside it.
function cleanName(value) {
  return typeof value === "string" ? value.replace(/[<>]/g, "").trim() : "";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Hark, traveler! This gate opens only for a POST. Knock again the proper way." });
  }

  // 1. Rate limit first, before touching any external API.
  const limit = checkRateLimit(getIp(req));
  if (limit.limited) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return res.status(429).json({
      error: `Easy there, champion! The arena crowd is hoarse and the gladiators need a breather. Return in ${limit.retryAfter} seconds!`,
    });
  }

  // 2. Validate input.
  const fighterA = cleanName(req.body?.fighterA);
  const fighterB = cleanName(req.body?.fighterB);
  if (!fighterA || !fighterB) {
    return res.status(400).json({ error: "An empty corner? Ladies and gentlemen, no brawl begins without TWO named challengers!" });
  }
  if (fighterA.length > MAX_NAME_LENGTH || fighterB.length > MAX_NAME_LENGTH) {
    return res
      .status(400)
      .json({ error: `By my lute, that name is a saga! The herald can only bellow ${MAX_NAME_LENGTH} letters or fewer. Trim thy title, brave soul!` });
  }

  // Repeat the client checks server-side (identical fighters, known protected characters).
  const matchup = validateMatchup(fighterA, fighterB);
  if (!matchup.ok) {
    return res.status(422).json({ code: matchup.code, error: matchup.message });
  }

  // 3. Verdict + both images, in parallel.
  const [verdictR, imageAR, imageBR] = await Promise.allSettled([
    getVerdict(fighterA, fighterB),
    generateImage(fighterA),
    generateImage(fighterB),
  ]);

  if (verdictR.status === "rejected") {
    console.error("Verdict failed:", verdictR.reason);
    return res.status(502).json({
      code: "verdict_failed",
      error: "Gasp! The Grand Judge has fallen asleep on the scrolls and no verdict was sung. Rouse them and call the fight again!",
    });
  }

  // The judge flagged a protected franchise character: reject, discard the images.
  if (verdictR.value.protected_side !== "none") {
    return res.status(422).json({ code: "invalid_matchup", error: PROTECTED_MESSAGE });
  }

  // Moderation-blocked is its own case, checked before generic image failure.
  const blocked = [
    ["A", imageAR],
    ["B", imageBR],
  ].find(([, r]) => r.status === "rejected" && r.reason?.moderationBlocked);
  if (blocked) {
    const [side] = blocked;
    const name = side === "A" ? fighterA : fighterB;
    // Provider safety-system rejection (can be a false positive on names that also
    // belong to modern franchises). Log which fighter so it can be diagnosed.
    console.warn(`Image moderation blocked side ${side}: "${name}"`);
    return res.status(422).json({
      code: "moderation_blocked",
      side,
      error: `The portrait painter refused to paint "${name}" this time. That is the image service's own safety filter, not a ruling against this fighter. Try again, or word the challenger a little differently (for example "armored warriors" instead of a bare name).`,
    });
  }

  if (imageAR.status === "rejected" || imageBR.status === "rejected") {
    console.error("Image failed:", imageAR.reason || imageBR.reason);
    return res.status(502).json({
      code: "image_failed",
      error: "Alas! The portrait painter dropped the brush and spilled the inks. Our heroes remain unpainted. Summon them once more!",
    });
  }

  const verdict = verdictR.value;
  return res.status(200).json({
    winner: verdict.winner === "A" ? fighterA : fighterB,
    winnerSide: verdict.winner,
    reasoning: verdict.reasoning,
    imageA: imageAR.value,
    imageB: imageBR.value,
  });
};

async function getVerdict(fighterA, fighterB) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `<fighter_a>${fighterA}</fighter_a>\n<fighter_b>${fighterB}</fighter_b>`,
      },
    ],
    output_config: {
      effort: "low",
      format: zodOutputFormat(VerdictSchema),
    },
  });

  const verdict = VerdictSchema.safeParse(response.parsed_output);
  if (response.stop_reason === "refusal" || !verdict.success) {
    throw new Error(`No usable verdict (stop_reason: ${response.stop_reason})`);
  }
  return verdict.data;
}

// One image per side via OpenAI. Returns a data: URI. Throws an Error with
// `moderationBlocked = true` when OpenAI's safety system rejects the prompt.
async function generateImage(fighter) {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // env only
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: buildImagePrompt(fighter),
      size: "1024x1024",
      quality: "low",
      output_format: "jpeg",
      n: 1,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = body?.error?.code;
    const err = new Error(`OpenAI image error ${r.status}: ${body?.error?.message || ""}`);
    err.moderationBlocked =
      code === "moderation_blocked" || code === "content_policy_violation";
    throw err;
  }
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return `data:image/jpeg;base64,${b64}`;
}
