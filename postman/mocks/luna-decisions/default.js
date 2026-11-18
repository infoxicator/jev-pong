/**
 * Stand-in for OpenAI Decisions (Luna, gpt-6-luna), as called by server/luna.ts and
 * server/benchmark-providers.ts with Web-standard fetch.
 *
 *   POST /v1/decisions   { model, input: [{ role, content: [input_text, input_json] }], questions: [{ type: "choice", name, choices }] }
 *                     -> { model, answers: [{ type, name, choice, confidence, probabilities: [{ value, probability }] }], usage }
 *
 * Answers are chosen only from the serialized input_json evidence:
 *   - "target" lanes: the lane nearest projected_intercept_y
 *   - "move": toward that lane from paddle
 *   - "shot" (tactical returns): the option that makes the opponent travel furthest
 *   - anything else: its first choice
 * Answers come back in reverse question order, because the adapter must match them by name.
 * The real model's choices, and its x-ratelimit-* headers, are not modelled; see context.yaml.
 */
const http = require("http");
const PORT = process.env.PORT || 4612;
const JSON_HEADER = { "Content-Type": "application/json" };
// Field geometry the game uses for its 17 paddle lanes (src/physics.ts: H=560, PADDLE_H=86).
const H = 560, PADDLE_H = 86, LANES = 17;
const MODEL = "gpt-6-luna";

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const path = req.url.split("?")[0];
  const body = readJson(req);

  // @endpoint POST /v1/decisions
  if (method === "POST" && path === "/v1/decisions") {
    if (!/^Bearer \S+/.test(req.headers.authorization || "")) {
      return send(res, 401, { error: { message: "Missing bearer token", type: "invalid_request_error" } });
    }
    const request = await body;
    if (!request || request.model !== MODEL || !Array.isArray(request.input) || !Array.isArray(request.questions) || !request.questions.length) {
      return send(res, 400, { error: { message: `model ${MODEL}, input and nonempty questions are required`, type: "invalid_request_error" } });
    }
    const content = (request.input[0] && request.input[0].content) || [];
    const evidence = (content.find(part => part && part.type === "input_json") || {}).data || {};
    const answers = [];
    for (const question of request.questions) {
      const values = Array.isArray(question && question.choices) ? question.choices.map(c => c && c.value).filter(Boolean) : [];
      if (!question || question.type !== "choice" || !question.name || !values.length) {
        return send(res, 501, { error: { message: `Question ${question && question.name} (${question && question.type}) is not modelled by this stand-in` } });
      }
      const choice = pick(question.name, values, evidence, answers);
      answers.push({ type: "choice", name: question.name, choice, confidence: 0.9, probabilities: [{ value: choice, probability: 0.9 }] });
    }
    const count = await counter();
    const inputTokens = Math.ceil(JSON.stringify(request).length / 4);
    res.setHeader("x-request-id", `sim-luna-${count}`);
    res.setHeader("x-postman-simulation", "luna-decisions");
    return send(res, 200, {
      model: MODEL,
      answers: answers.reverse(),
      usage: { input_tokens: inputTokens, output_tokens: answers.length, total_tokens: inputTokens + answers.length },
    });
  }

  // Other OpenAI routes are not on the game's path.
  send(res, 501, { error: { message: `${method} ${path} is not called by jev-pong`, type: "not_modelled" } });
});

function pick(name, values, evidence, answered) {
  if (name === "target" && Number.isFinite(evidence.projected_intercept_y)) {
    const index = Math.max(0, Math.min(LANES - 1, Math.round((evidence.projected_intercept_y - PADDLE_H / 2) / ((H - PADDLE_H) / (LANES - 1)))));
    return values.includes(`lane_${index}`) ? `lane_${index}` : values[0];
  }
  const target = answered.find(a => a.name === "target");
  if (name === "move" && target && Number.isFinite(evidence.paddle)) {
    const y = PADDLE_H / 2 + Number(target.choice.replace("lane_", "")) * (H - PADDLE_H) / (LANES - 1);
    const move = Math.abs(y - evidence.paddle) < 7 ? "stay" : y < evidence.paddle ? "up" : "down";
    return values.includes(move) ? move : values[0];
  }
  if (name === "shot" && Array.isArray(evidence.options)) {
    const ranked = evidence.options.filter(o => values.includes(o.id)).sort((a, b) => b.opponentTravelPx - a.opponentTravelPx);
    if (ranked.length) return ranked[0].id;
  }
  return values[0];
}

async function counter() {
  const count = ((await pm.state.get("luna-decisions:requests")) || 0) + 1;
  await pm.state.set("luna-decisions:requests", count);
  return count;
}

function send(res, status, payload) {
  res.writeHead(status, JSON_HEADER);
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null);
      } catch { resolve(null); }
    });
  });
}

server.listen(PORT, () => console.log(`luna-decisions stand-in on port ${PORT}`));
