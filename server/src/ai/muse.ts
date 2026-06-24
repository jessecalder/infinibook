// The interactive Muse: turns a creative suggestion into a short prose
// continuation. Uses Claude when ANTHROPIC_API_KEY is set; otherwise falls back
// to a deterministic mock so the feature works with no key and no cost.

import Anthropic from "@anthropic-ai/sdk";

export interface MuseRequest {
  premise: string;
  genre: string;
  canon: string;   // the approved story so far
  draft: string;   // the in-progress chapter
  suggestion: string;
}

const MODEL = "claude-opus-4-8";

export async function generateMuseContinuation(req: MuseRequest): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await viaClaude(req);
    } catch (err) {
      console.error("Muse: Claude call failed, using mock —", (err as Error).message);
    }
  }
  return mockContinuation(req);
}

async function viaClaude(req: MuseRequest): Promise<string> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  const system =
    "You are the Muse — a collaborative fiction-writing partner. Given a story " +
    "so far and a creative direction, write a SHORT continuation (one to three " +
    "sentences, at most a short paragraph) that picks up exactly where the draft " +
    "leaves off and embodies the suggested direction. Match the established voice, " +
    "tense, and tone. Do not summarize, explain, or add commentary — output only " +
    "the prose to be inserted, with no surrounding quotation marks or labels.";

  const parts = [
    `Premise: ${req.premise}`,
    `Genre: ${req.genre}`,
    req.canon.trim() && `Story so far (earlier chapters):\n${clip(req.canon, 4000)}`,
    req.draft.trim()
      ? `The current chapter draft (continue from its end):\n${clip(req.draft, 4000)}`
      : "The current chapter is empty — write an opening line.",
    `Creative direction from the writer: ${req.suggestion}`,
    "Write the continuation now.",
  ].filter(Boolean);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return text || mockContinuation(req);
}

// Deterministic stand-in. Reads as a plausible nudge built from the suggestion,
// clearly distinct from the writer's own prose.
function mockContinuation(req: MuseRequest): string {
  const seed = req.suggestion.replace(/[".]+$/g, "").toLowerCase();
  const templates = [
    `She paused, and the thought took shape: ${seed}. It would not let her go.`,
    `Something shifted — ${seed} — and the room seemed to lean in to listen.`,
    `For the first time she let herself follow it: ${seed}, wherever it led.`,
  ];
  const idx = Math.abs(hash(req.suggestion)) % templates.length;
  return templates[idx];
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(s.length - max);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
