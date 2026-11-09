// POST /api/fight  { fighterA, fighterB }
// Stage 3 (verdict half): rate limit -> Claude verdict (zod structured output).
// Image generation is not wired in yet.

const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");
const { JUDGE_SYSTEM_PROMPT } = require("./judge-prompt");

const MODEL = "claude-sonnet-5-5";
const MAX_NAME_LENGTH = 100;

// Output shape enforced via native structured outputs + zod.
const VerdictSchema = z.object({
  winner: z.enum(["A", "B"]),
  reasoning: z.string(),
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
    return res.status(405).json({ error: "Use POST." });
  }

  // 1. Rate limit first, before touching any external API.
  const limit = checkRateLimit(getIp(req));
  if (limit.limited) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return res.status(429).json({
      error: `Too many fights! Try again in ${limit.retryAfter} seconds.`,
    });
  }

  // 2. Validate input.
  const fighterA = cleanName(req.body?.fighterA);
  const fighterB = cleanName(req.body?.fighterB);
  if (!fighterA || !fighterB) {
    return res.status(400).json({ error: "Both fighters need a name." });
  }
  if (fighterA.length > MAX_NAME_LENGTH || fighterB.length > MAX_NAME_LENGTH) {
    return res
      .status(400)
      .json({ error: `Keep fighter names under ${MAX_NAME_LENGTH} characters.` });
  }

  // 3. Verdict from Claude.
  try {
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

    return res.status(200).json({
      winner: verdict.data.winner === "A" ? fighterA : fighterB,
      winnerSide: verdict.data.winner,
      reasoning: verdict.data.reasoning,
    });
  } catch (err) {
    console.error("Verdict failed:", err);
    return res
      .status(502)
      .json({ error: "The judge couldn't reach a verdict. Please try again." });
  }
};
