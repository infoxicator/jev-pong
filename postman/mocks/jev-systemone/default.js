/**
 * Stand-in for TypeSafe System One (Jev), as called by server/jev.ts and
 * server/benchmark-providers.ts through @typesafe-ai/sdk 0.7.0.
 *
 *   POST /v1/systemone   { model, state, questions: { <name>: { type: "choice", criteria } } }
 *                     -> { model, answers: { <name>: { type, choice, confidence, probabilities } }, usage }
 *
 * Answers are chosen only from what the request serialized, the same way a model would have to:
 *   - "target" lanes: the lane nearest state.projected_intercept_y
 *   - "move": toward that lane from state.paddle
 *   - "shot" (tactical returns): the option that makes the opponent travel furthest
 *   - anything else: its first label
 * The real model's choices are not modelled; see the simulation's context.yaml.
 */
const http = require("http");
const PORT = process.env.PORT || 4611;
const JSON_HEADER = { "Content-Type": "application/json" };
// Field geometry the game uses for its 17 paddle lanes (src/physics.ts: H=560, PADDLE_H=86).
const H = 560, PADDLE_H = 86, LANES = 17;

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const path = req.url.split("?")[0];
  const body = readJson(req);

  // @endpoint POST /v1/systemone
  if (method === "POST" && path === "/v1/systemone") {
    if (!/^Bearer \S+/.test(req.headers.authorization || "")) {
      return send(res, 401, { error: { message: "Missing bearer token" } });
    }
    const request = await body;
    const questions = request && request.questions;
    if (!request || request.state == null || !questions || typeof questions !== "object" || !Object.keys(questions).length) {
      return send(res, 422, { error: { message: "state and nonempty questions are required" } });
    }
    const state = typeof request.state === "object" ? request.state : {};
    const answers = {};
    for (const [name, question] of Object.entries(questions)) {
      if (!question || question.type !== "choice" || !question.criteria || !Object.keys(question.criteria).length) {
        // The game only asks choice questions; anything else is a call this stand-in doesn't model.
        return send(res, 501, { error: { message: `Question "${name}" (${question && question.type}) is not modelled by this stand-in` } });
      }
      answers[name] = answer(pick(name, Object.keys(question.criteria), state, answers));
    }
    const count = await counter();
    res.setHeader("x-typesafe-request-id", `sim-jev-${count}`);
    res.setHeader("x-postman-simulation", "jev-systemone");
    return send(res, 200, {
      model: request.model || "jev-latest",
      answers,
      usage: { input_tokens: Math.ceil(JSON.stringify(request).length / 4), output_tokens: Object.keys(answers).length },
    });
  }

  // Other TypeSafe routes (models, assets, ...) are not on the game's path.
  send(res, 501, { error: "Not modelled", message: `${method} ${path} is not called by jev-pong` });
});

function pick(name, labels, state, answered) {
  if (name === "target" && Number.isFinite(state.projected_intercept_y)) {
    const index = Math.max(0, Math.min(LANES - 1, Math.round((state.projected_intercept_y - PADDLE_H / 2) / ((H - PADDLE_H) / (LANES - 1)))));
    return labels.includes(`lane_${index}`) ? `lane_${index}` : labels[0];
  }
  if (name === "move" && answered.target && Number.isFinite(state.paddle)) {
    const index = Number(answered.target.choice.replace("lane_", ""));
    const target = PADDLE_H / 2 + index * (H - PADDLE_H) / (LANES - 1);
    const move = Math.abs(target - state.paddle) < 7 ? "stay" : target < state.paddle ? "up" : "down";
    return labels.includes(move) ? move : labels[0];
  }
  const options = state.situation && Array.isArray(state.situation.options) ? state.situation.options : null;
  if (name === "shot" && options) {
    const ranked = options.filter(o => labels.includes(o.id)).sort((a, b) => b.opponentTravelPx - a.opponentTravelPx);
    if (ranked.length) return ranked[0].id;
  }
  return labels[0];
}

function answer(choice) {
  return { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
}

async function counter() {
  const count = ((await pm.state.get("jev-systemone:requests")) || 0) + 1;
  await pm.state.set("jev-systemone:requests", count);
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

server.listen(PORT, () => console.log(`jev-systemone stand-in on port ${PORT}`));
