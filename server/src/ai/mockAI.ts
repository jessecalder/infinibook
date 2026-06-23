// Mock AI module.
//
// This simulates the three AI roles from the design doc — Proofreader,
// Continuity keeper, and Muse — with deterministic heuristics instead of a
// real model. The shapes returned here are exactly what a real LLM-backed
// orchestration service would return, so swapping in a live model later means
// replacing the bodies of these functions, not the callers.

import type { AIFlag, AIReview, BibleEntry, MusePrompt } from "../types.js";
import { newId } from "../store.js";

// Small artificial delay so the UI can show a "reviewing…" state.
export function fakeLatency(ms = 700): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Proofreader: surface-level writing feedback ---------------------------

function proofread(body: string): AIFlag[] {
  const flags: AIFlag[] = [];
  const text = body.trim();

  if (text.length < 200) {
    flags.push({
      kind: "proofread",
      severity: "warning",
      message:
        "This chapter is quite short. Consider developing the scene a little more before submitting.",
    });
  }

  // Double spaces.
  if (/ {2,}/.test(text)) {
    flags.push({
      kind: "proofread",
      severity: "suggestion",
      message: "Found double spaces — tighten to single spaces.",
    });
  }

  // Very long sentences (rough heuristic).
  const longSentence = text
    .split(/(?<=[.!?])\s+/)
    .find((s) => s.split(/\s+/).length > 45);
  if (longSentence) {
    flags.push({
      kind: "proofread",
      severity: "suggestion",
      message: "One sentence runs long — consider splitting it for rhythm.",
      excerpt: longSentence.slice(0, 80) + (longSentence.length > 80 ? "…" : ""),
    });
  }

  // Overused filler words.
  for (const word of ["very", "really", "just", "suddenly"]) {
    const count = (text.match(new RegExp(`\\b${word}\\b`, "gi")) || []).length;
    if (count >= 3) {
      flags.push({
        kind: "proofread",
        severity: "info",
        message: `"${word}" appears ${count} times — varying it would strengthen the prose.`,
      });
    }
  }

  return flags;
}

// --- Continuity keeper: check against the story bible ----------------------

function continuityCheck(body: string, bible: BibleEntry[]): AIFlag[] {
  const flags: AIFlag[] = [];
  const lower = body.toLowerCase();

  // Naive contradiction heuristics keyed off established facts.
  // (A real model would reason over the canon; this demonstrates the surface.)
  const liesl = bible.find((e) => e.name === "Liesl");
  if (liesl && /\bliesl\b/.test(lower)) {
    if (/liesl (opened|opens|broke|breaks) the (sealed )?(letter|glass)/.test(lower)) {
      flags.push({
        kind: "continuity",
        severity: "warning",
        message:
          "Liesl opening the sealed letter contradicts the established rule that one does not open a memory before its time. Is this an intentional turning point?",
      });
    }
  }

  // Reference to a character not in canon (very rough): flag obviously new
  // proper-noun "brother/sister" claims, as an example of relationship drift.
  if (/liesl'?s (brother|sister|mother|father)\b/.test(lower)) {
    flags.push({
      kind: "continuity",
      severity: "info",
      message:
        "This introduces a family member for Liesl that isn't in the story bible yet. If intended, it'll be added to canon on approval.",
    });
  }

  return flags;
}

// --- Spoiler check: never let sealed material leak -------------------------

function spoilerCheck(body: string, bible: BibleEntry[]): AIFlag[] {
  const flags: AIFlag[] = [];
  const lower = body.toLowerCase();

  const sealed = bible.filter((e) => e.type === "sealed");
  for (const s of sealed) {
    // Demo heuristic: the sealed ending is "Liesl sealed the letter herself".
    if (
      /liesl .*(sealed|wrote) .*(the )?letter (herself|to herself)/.test(lower) ||
      /she (had )?sealed it herself/.test(lower)
    ) {
      flags.push({
        kind: "spoiler",
        severity: "block",
        message:
          "This appears to reveal a host-sealed plot point ahead of time. Sealed material can't be disclosed yet — please revise so the reveal stays hidden.",
      });
    }
  }

  return flags;
}

// --- Orchestration: run the full review pipeline ---------------------------

export async function reviewChapter(
  body: string,
  bible: BibleEntry[]
): Promise<AIReview> {
  await fakeLatency();

  const flags: AIFlag[] = [
    ...proofread(body),
    ...continuityCheck(body, bible),
    ...spoilerCheck(body, bible),
  ];

  const hasBlock = flags.some((f) => f.severity === "block");
  const decision = hasBlock ? "returned" : "approved";

  const summary = hasBlock
    ? "Returned: a sealed plot point would be revealed too early. The rest reads well — revise the flagged passage and resubmit."
    : flags.length === 0
    ? "Approved cleanly. Lovely work — no issues found."
    : "Approved with optional suggestions. None block publication; take or leave them.";

  return {
    decision,
    flags,
    summary,
    reviewedAt: new Date().toISOString(),
  };
}

// --- Muse: optional, spoiler-safe prompts ----------------------------------

export function musePrompts(
  bible: BibleEntry[],
  upToIndex: number
): MusePrompt[] {
  // Only retrieve open threads/canon the author is allowed to know.
  // Sealed entries (huge spoilerScope) are never surfaced.
  const openThreads = bible.filter(
    (e) => e.type === "thread" && e.spoilerScope <= upToIndex
  );

  const prompts: string[] = [];

  for (const t of openThreads) {
    prompts.push(`Pick up the open thread: "${t.name}" — push it forward without resolving it.`);
  }

  // A few evergreen, spoiler-safe nudges.
  prompts.push(
    "Introduce a small physical detail about the warm glass that deepens the mystery.",
    "Give Liesl a choice she can't take back, then end the chapter before she acts.",
    "Bring Tomas back, but have him say less than he knows."
  );

  return prompts.slice(0, 4).map((text) => ({ id: newId(), text }));
}
