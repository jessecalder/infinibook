import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, getSession, setSession, clearSession } from "./api.js";
import type { Book, BookDetail, AIReview, MusePrompt } from "./types.js";

// ---------------------------------------------------------------------------
// Theme (light / dark) — persisted, defaults to system preference
// ---------------------------------------------------------------------------
function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("ib_theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ib_theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")) };
}

// ---------------------------------------------------------------------------
// Writing font — a few reading-friendly choices. iA Writer's own fonts are
// used if installed locally; IBM Plex (their basis) and Literata are the
// loaded fallbacks. Applied via the --editor-font CSS variable.
// ---------------------------------------------------------------------------
const FONTS = [
  { id: "ia-quattro", label: "iA Quattro", stack: `"iA Writer Quattro", "IBM Plex Sans", Charter, Georgia, serif` },
  { id: "ia-duo", label: "iA Duo", stack: `"iA Writer Duo", "IBM Plex Mono", ui-monospace, monospace` },
  { id: "ia-mono", label: "iA Mono", stack: `"iA Writer Mono", "IBM Plex Mono", ui-monospace, monospace` },
  { id: "literata", label: "Literata", stack: `"Literata", Georgia, "Iowan Old Style", serif` },
  { id: "charter", label: "Charter", stack: `Charter, "Iowan Old Style", Georgia, serif` },
] as const;

function useFont() {
  const [fontId, setFontId] = useState<string>(() => localStorage.getItem("ib_font") || FONTS[0].id);
  useEffect(() => {
    const f = FONTS.find((x) => x.id === fontId) ?? FONTS[0];
    document.documentElement.style.setProperty("--editor-font", f.stack);
    localStorage.setItem("ib_font", fontId);
  }, [fontId]);
  return { fontId, setFontId };
}

// ---------------------------------------------------------------------------
// Corner-toggle icons (Tabler "Writerly" set). All inherit `currentColor` so
// the active-state CSS can recolor them.
// ---------------------------------------------------------------------------
function Icon({ name }: { name: "sun" | "moon" | "target" | "sparkles" | "eyeglass" | "feather" | "notebook" }) {
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "sun":
      return (
        <svg {...p}>
          <path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
          <path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />
        </svg>
      );
    case "moon":
      return (
        <svg {...p}>
          <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008" />
        </svg>
      );
    case "target":
      return (
        <svg {...p}>
          <path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          <path d="M12 7a5 5 0 1 0 5 5" />
          <path d="M13 3.055a9 9 0 1 0 7.941 7.945" />
          <path d="M15 6v3h3l3 -3h-3v-3l-3 3" />
          <path d="M15 9l-3 3" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...p}>
          <path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6" />
        </svg>
      );
    case "eyeglass":
      return (
        <svg {...p}>
          <path d="M8 4h-2l-3 10" />
          <path d="M16 4h2l3 10" />
          <path d="M10 16l4 0" />
          <path d="M21 16.5a3.5 3.5 0 0 1 -7 0v-2.5h7v2.5" />
          <path d="M10 16.5a3.5 3.5 0 0 1 -7 0v-2.5h7v2.5" />
        </svg>
      );
    case "feather":
      return (
        <svg {...p}>
          <path d="M4 20l10 -10m0 -5v5h5m-9 -1v5h5m-9 -1v5h5m-5 -5l4 -4l4 -4" />
          <path d="M19 10c.638 -.636 1 -1.515 1 -2.486a3.515 3.515 0 0 0 -3.517 -3.514c-.97 0 -1.847 .367 -2.483 1m-3 13l4 -4l4 -4" />
        </svg>
      );
    case "notebook":
      return (
        <svg {...p}>
          <path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-11a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1m3 0v18" />
          <path d="M13 8l2 0" />
          <path d="M13 12l2 0" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Focus-mode editor — a transparent textarea over a highlight backdrop.
// Only the paragraph under the caret stays sharp; everything else dims.
// ---------------------------------------------------------------------------
function paragraphBounds(text: string, caret: number): [number, number] {
  // A paragraph runs between hard line breaks. Walk back to just after the
  // previous newline and forward to the next one.
  let start = 0;
  for (let i = caret - 1; i >= 0; i--) {
    if (text.charAt(i) === "\n") { start = i + 1; break; }
  }
  let end = text.length;
  for (let i = caret; i < text.length; i++) {
    if (text.charAt(i) === "\n") { end = i; break; }
  }
  if (end < start) end = start;
  return [start, end];
}

// ---------------------------------------------------------------------------
// Marginalia — annotations drawn like a reader's marks. Two distinct voices:
//   • the Muse (creative): inspiration, direction, threads to pull
//   • the Editor (objective): wordiness, structure, spelling, continuity
// plus the writer's own annotations. Each is a mock stand-in for the AI.
// Marginalia measures the ranges and draws underlines / circles / brackets
// with handwritten margin notes and connector arrows.
// ---------------------------------------------------------------------------
interface Located {
  id: string;
  kind: "underline" | "circle" | "bracket" | "spelling";
  range: [number, number];
  note: string;
}

// The Muse stays in the margin (its prompts), and deliberately does NOT mark up
// the prose — marking the just-written word as you type is distracting. Marking
// the text itself is the Editor's job.

// The Editor — objective proofing of wording and structure.
function deriveEditor(text: string): Located[] {
  const out: Located[] = [];

  // 1) First noticeable adverb — gently question it.
  const adv = /\b(\w{4,}ly)\b/.exec(text);
  if (adv) {
    out.push({
      id: "adv",
      kind: "underline",
      range: [adv.index, adv.index + adv[1].length],
      note: "wordy — needed?",
    });
  }

  // 2) The longest sentence — suggest breaking it up.
  const sentences: { start: number; end: number; words: number }[] = [];
  let s = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "." || c === "!" || c === "?") {
      const seg = text.slice(s, i + 1);
      const lead = seg.length - seg.trimStart().length;
      const words = seg.trim().split(/\s+/).filter(Boolean).length;
      sentences.push({ start: s + lead, end: i + 1, words });
      s = i + 1;
    }
  }
  const longest = [...sentences].sort((a, b) => b.words - a.words)[0];
  if (longest && longest.words >= 18) {
    out.push({
      id: "long",
      kind: "bracket",
      range: [longest.start, longest.end],
      note: "long — break it up?",
    });
  }

  return out.slice(0, 2);
}

// A few commonly-misspelled words so the proofreader's mark has something to
// catch (a lightweight stand-in for a real spell-checker / the AI).
const MISSPELLINGS = new Set([
  "teh", "recieve", "seperate", "definately", "occured", "untill", "wich",
  "beleive", "tommorow", "alot", "wierd", "accross", "arguement", "calender",
  "collegue", "embarass", "existance", "goverment", "independant", "occassion",
  "priviledge", "publically", "reccomend", "rythm", "supercede", "tendancy",
  "truely", "writting", "neccessary", "occurence", "persistant", "posession",
  "refered", "relevent", "speach", "suprise", "thier", "wether", "yu",
]);

function findMisspellings(text: string): Located[] {
  const out: Located[] = [];
  const re = /[A-Za-z']+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (MISSPELLINGS.has(m[0].toLowerCase())) {
      out.push({ id: `sp-${m.index}`, kind: "spelling", range: [m.index, m.index + m[0].length], note: "sp" });
    }
  }
  return out.slice(0, 5);
}

type Rect = { left: number; top: number; width: number; height: number };
type Side = "left" | "right";
type AnnoKind = "underline" | "circle" | "bracket" | "spelling" | "arrow" | "note";
type AnnoSource = "muse" | "editor" | "user";

// A passage the Muse generated and inserted into the draft.
interface AiSegment {
  id: string;
  text: string;
  hidden: boolean;
  anchor?: number; // where to re-insert when un-hiding
}

// User-added annotation (stored in BookView, persisted per book).
interface UserAnno {
  id: string;
  kind: "underline" | "circle" | "arrow" | "note";
  range: [number, number];
  text?: string;
}

interface AnnoInput {
  id: string;
  source: AnnoSource;
  kind: AnnoKind;
  range: [number, number];
  text?: string;
}

// Margin-note width — must match `.mnote { width }` in styles.css.
const NOTE_W = 165;

interface PlacedAnno {
  id: string;
  source: AnnoSource;
  kind: AnnoKind;
  rects: Rect[];
  side: Side;
  hasStroke: boolean;
  hasConnector: boolean;
  hasNote: boolean;
  text: string;
  noteX: number;
  noteY: number;
  anchorX: number;
  anchorY: number;
}

function markStrokes(m: PlacedAnno) {
  if (m.kind === "underline") {
    return m.rects.map((r, i) => (
      <path
        key={i}
        d={`M ${r.left} ${r.top + r.height - 1} L ${r.left + r.width} ${r.top + r.height - 1}`}
      />
    ));
  }
  if (m.kind === "circle" || m.kind === "spelling") {
    const r = m.rects[0];
    return (
      <ellipse
        cx={r.left + r.width / 2}
        cy={r.top + r.height / 2}
        rx={r.width / 2 + 8}
        ry={r.height / 2 + 3}
      />
    );
  }
  // bracket: a tall square bracket on the same side as the note
  const top = Math.min(...m.rects.map((r) => r.top));
  const bot = Math.max(...m.rects.map((r) => r.top + r.height));
  if (m.side === "left") {
    const x = Math.min(...m.rects.map((r) => r.left)) - 6;
    return <path d={`M ${x + 6} ${top} L ${x} ${top} L ${x} ${bot} L ${x + 6} ${bot}`} />;
  }
  const x = Math.max(...m.rects.map((r) => r.left + r.width)) + 6;
  return <path d={`M ${x - 6} ${top} L ${x} ${top} L ${x} ${bot} L ${x - 6} ${bot}`} />;
}

function connectorPath(m: PlacedAnno): string {
  const x1 = m.side === "left" ? m.noteX + NOTE_W : m.noteX;
  const y1 = m.noteY + 9;
  const x2 = m.anchorX;
  const y2 = m.anchorY;
  const mx = (x1 + x2) / 2;
  const ah = m.side === "left" ? -5 : 5; // arrowhead opens away from the text
  // curve from the note to the text edge, then a small arrowhead pointing at it
  return `M ${x1} ${y1} Q ${mx} ${y1} ${x2} ${y2} M ${x2} ${y2} l ${ah} ${-3} M ${x2} ${y2} l ${ah} ${3}`;
}

function Marginalia({
  editorRef,
  value,
  prompts,
  onMuseGenerate,
  busyPromptId,
  userAnnos,
  onChangeUserNote,
  onRemoveUserNote,
  aiSegments,
  onDiscardSegment,
  onHideSegment,
  showMuse,
  showEditor,
  showUser,
  annotateMode,
}: {
  editorRef: RefObject<HTMLDivElement>;
  value: string;
  prompts: MusePrompt[];
  onMuseGenerate: (id: string, text: string) => void;
  busyPromptId: string | null;
  userAnnos: UserAnno[];
  onChangeUserNote: (id: string, text: string) => void;
  onRemoveUserNote: (id: string) => void;
  aiSegments: AiSegment[];
  onDiscardSegment: (id: string) => void;
  onHideSegment: (id: string) => void;
  showMuse: boolean;
  showEditor: boolean;
  showUser: boolean;
  annotateMode: boolean;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [placed, setPlaced] = useState<PlacedAnno[]>([]);
  const [freeNotes, setFreeNotes] =
    useState<Array<{ id: string; text: string; side: Side; x: number; y: number }>>([]);
  const [aiPlaced, setAiPlaced] =
    useState<Array<{ id: string; hidden: boolean; chip: Rect }>>([]);

  const compute = useCallback(() => {
    const editor = editorRef.current;
    const node = measureRef.current?.firstChild as Text | null;
    if (!editor) return;
    const er = editor.getBoundingClientRect();
    setBox({ w: er.width, h: er.height });

    const rectsFor = (start: number, end: number): Rect[] => {
      if (!node) return [];
      const len = node.length;
      let s = Math.max(0, Math.min(start, len));
      let e = Math.max(0, Math.min(end, len));
      if (s === e) {
        // collapsed (a bare anchor) — borrow an adjacent character for the line
        if (e < len) e = s + 1;
        else if (s > 0) s = s - 1;
      }
      const range = document.createRange();
      try {
        range.setStart(node, s);
        range.setEnd(node, e);
      } catch {
        return [];
      }
      return Array.from(range.getClientRects()).map((r) => ({
        left: r.left - er.left,
        top: r.top - er.top,
        width: r.width,
        height: r.height,
      }));
    };

    const noteXFor = (side: Side) => (side === "left" ? -(NOTE_W + 28) : er.width + 28);
    const cursor: Record<Side, number> = { left: 0, right: 0 };

    const inputs: AnnoInput[] = [
      ...deriveEditor(value).map((a) => ({ ...a, source: "editor" as const, text: a.note })),
      ...findMisspellings(value).map((a) => ({ ...a, source: "editor" as const, text: a.note })),
      ...userAnnos.map((a) => ({
        id: a.id,
        kind: a.kind as AnnoKind,
        range: a.range,
        source: "user" as const,
        text: a.text,
      })),
    ];

    const out: PlacedAnno[] = [];
    for (const a of inputs) {
      const rects = rectsFor(a.range[0], a.range[1]);
      if (!rects.length) continue;
      const first = rects[0];
      const side: Side = first.left + first.width / 2 < er.width / 2 ? "left" : "right";
      const hasStroke =
        a.kind === "underline" || a.kind === "circle" || a.kind === "bracket" || a.kind === "spelling";
      const hasNote = a.text !== undefined; // note box (Muse text, "sp", or user note)
      const hasConnector = hasNote || a.kind === "arrow";
      const needsSlot = hasNote || a.kind === "arrow";
      const anchorX = side === "left" ? 2 : er.width - 2;
      const anchorY = first.top + first.height / 2;
      let noteY = anchorY - 10;
      if (needsSlot) {
        noteY = Math.max(noteY, cursor[side]);
        cursor[side] = noteY + 56;
      }
      out.push({
        id: a.id,
        source: a.source,
        kind: a.kind,
        rects,
        side,
        hasStroke,
        hasConnector,
        hasNote,
        text: a.text ?? "",
        noteX: noteXFor(side),
        noteY,
        anchorX,
        anchorY,
      });
    }
    setPlaced(out);

    // General Muse notes (prompts) alternate margins, below the located ones.
    const genCursor: Record<Side, number> = {
      left: Math.max(cursor.left + 16, er.height * 0.5),
      right: Math.max(cursor.right + 16, er.height * 0.5),
    };
    setFreeNotes(
      prompts.slice(0, 2).map((p, i) => {
        const side: Side = i % 2 === 0 ? "right" : "left";
        const y = genCursor[side];
        genCursor[side] = y + 128;
        return { id: p.id, text: p.text, side, x: noteXFor(side), y };
      })
    );

    // Place each Muse passage's control chip: visible passages get a chip at the
    // end of the text; hidden ones get a "show" pill at their stored anchor.
    const aiOut: Array<{ id: string; hidden: boolean; chip: Rect }> = [];
    let scan = 0;
    for (const seg of aiSegments) {
      if (seg.hidden) {
        const a = Math.min(seg.anchor ?? value.length, value.length);
        const rects = rectsFor(a, a);
        if (rects.length) aiOut.push({ id: seg.id, hidden: true, chip: rects[0] });
      } else {
        const at = value.indexOf(seg.text, scan);
        if (at < 0) continue; // edited away
        scan = at + seg.text.length;
        const rects = rectsFor(at, at + seg.text.length);
        if (rects.length) aiOut.push({ id: seg.id, hidden: false, chip: rects[rects.length - 1] });
      }
    }
    setAiPlaced(aiOut);
  }, [value, prompts, userAnnos, aiSegments, editorRef]);

  // Structural changes (mount, new prompts, the writer adding an annotation)
  // recompute immediately; typing is debounced so marks settle once you pause
  // instead of twitching on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { compute(); }, [prompts, userAnnos, aiSegments]);
  useEffect(() => {
    const id = setTimeout(compute, 1200);
    return () => clearTimeout(id);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [compute]);

  const fadedFor = (source: AnnoSource) =>
    (source === "muse" && !showMuse) ||
    (source === "editor" && !showEditor) ||
    (source === "user" && !showUser);

  return (
    <>
      <div className="measure-layer" aria-hidden="true" ref={measureRef}>
        {value}
        {"\n"}
      </div>
      <svg className="marginalia-svg" width={box.w} height={box.h} aria-hidden="true">
        <defs>
          <filter id="sketch" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" />
          </filter>
        </defs>
        <g filter="url(#sketch)">
          {placed.map((m) => (
            <g key={m.id} className={`anno ${m.source} ${fadedFor(m.source) ? "faded" : ""}`}>
              {m.hasStroke && markStrokes(m)}
              {m.hasConnector && <path className="connector" d={connectorPath(m)} />}
            </g>
          ))}
        </g>
      </svg>
      <div className="margin-notes">
        {placed.map((m) => {
          if (!m.hasNote) return null;
          const faded = fadedFor(m.source) ? "faded" : "";
          const sp = m.kind === "spelling" ? "sp" : "";
          if (m.source === "user" && m.kind === "note" && annotateMode) {
            return (
              <input
                key={m.id}
                className={`mnote user ${m.side} ${faded}`}
                style={{ left: m.noteX, top: m.noteY }}
                value={m.text}
                placeholder="your note…"
                autoFocus={m.text === ""}
                onChange={(e) => onChangeUserNote(m.id, e.target.value)}
                onBlur={() => { if (!m.text.trim()) onRemoveUserNote(m.id); }}
              />
            );
          }
          return (
            <div
              key={m.id}
              className={`mnote ${m.source} ${m.side} ${sp} ${faded}`}
              style={{ left: m.noteX, top: m.noteY }}
            >
              {m.text}
            </div>
          );
        })}
        {freeNotes.map((n) => {
          const busy = busyPromptId === n.id;
          return (
            <div
              key={n.id}
              className={`mnote muse general ephemeral ${n.side} ${!showMuse ? "faded" : ""} ${busy ? "busy" : ""}`}
              style={{ left: n.x, top: n.y }}
              onClick={() => !busy && onMuseGenerate(n.id, n.text)}
              title={`${n.text} — click and the Muse will write it in`}
            >
              {busy ? "✦ weaving…" : n.text.length > 72 ? `${n.text.slice(0, 72)}…` : n.text}
            </div>
          );
        })}
      </div>
      {/* Per-passage controls: hidden passages show a "show" pill at their anchor;
          visible passages get hide/discard at the end of the text. */}
      <div className="ai-chips">
        {aiPlaced.map((a) =>
          a.hidden ? (
            <button
              key={a.id}
              className="ai-chip show-pill"
              style={{ left: a.chip.left, top: a.chip.top }}
              onClick={() => onHideSegment(a.id)}
              title="Show the hidden Muse passage"
            >
              ✦ show
            </button>
          ) : (
            <div
              key={a.id}
              className="ai-chip"
              style={{ left: a.chip.left + a.chip.width, top: a.chip.top }}
            >
              <button onClick={() => onHideSegment(a.id)} title="Hide this passage">hide</button>
              <button onClick={() => onDiscardSegment(a.id)} title="Discard this passage">✕</button>
            </div>
          )
        )}
      </div>
    </>
  );
}

function FocusEditor({
  value,
  onChange,
  focusMode,
  placeholder,
  prompts,
  onMuseGenerate,
  busyPromptId,
  showMuse,
  showEditor,
  userAnnos,
  onChangeUserNote,
  onRemoveUserNote,
  aiSegments,
  onDiscardSegment,
  onHideSegment,
  showUser,
  annotateMode,
  onSelectionChange,
}: {
  value: string;
  onChange: (v: string) => void;
  focusMode: boolean;
  placeholder?: string;
  prompts: MusePrompt[];
  onMuseGenerate: (id: string, text: string) => void;
  busyPromptId: string | null;
  showMuse: boolean;
  showEditor: boolean;
  userAnnos: UserAnno[];
  onChangeUserNote: (id: string, text: string) => void;
  onRemoveUserNote: (id: string) => void;
  aiSegments: AiSegment[];
  onDiscardSegment: (id: string) => void;
  onHideSegment: (id: string) => void;
  showUser: boolean;
  annotateMode: boolean;
  onSelectionChange: (start: number, end: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [caretPos, setCaretPos] =
    useState<{ left: number; top: number; height: number } | null>(null);

  // Auto-grow the textarea (no internal scroll) and locate the custom caret by
  // measuring a zero-width marker in the always-present mirror layer. Done
  // together so every overlay stays pixel-aligned with the textarea.
  const recompute = useCallback(() => {
    const ta = ref.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
    const marker = markerRef.current;
    const editor = editorRef.current;
    if (marker && editor) {
      const m = marker.getBoundingClientRect();
      const e = editor.getBoundingClientRect();
      // A touch taller than the text line, centered on it.
      const grow = 7;
      setCaretPos({
        left: m.left - e.left,
        top: m.top - e.top - grow / 2,
        height: m.height + grow,
      });
    }
  }, []);

  useLayoutEffect(() => { recompute(); }, [value, caret, focusMode, recompute]);

  useEffect(() => {
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [recompute]);

  useEffect(() => { ref.current?.focus(); }, []);

  function syncCaret() {
    const ta = ref.current;
    if (!ta) return;
    setCaret(ta.selectionStart ?? 0);
    onSelectionChange(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
  }

  const [start, end] = focusMode ? paragraphBounds(value, caret) : [0, value.length];

  // Char ranges of the visible Muse-written passages, for gradient-colored text.
  const aiRanges = useMemo(() => {
    const out: Array<[number, number]> = [];
    let scan = 0;
    for (const seg of aiSegments) {
      if (seg.hidden) continue;
      const at = value.indexOf(seg.text, scan);
      if (at < 0) continue;
      scan = at + seg.text.length;
      out.push([at, at + seg.text.length]);
    }
    return out;
  }, [value, aiSegments]);

  // The visible text is rendered here (the textarea itself is transparent), split
  // into runs so AI passages get gradient glyphs and off-focus paragraphs dim.
  const runs = useMemo(() => {
    const pts = new Set<number>([0, value.length]);
    if (focusMode) { pts.add(start); pts.add(end); }
    for (const [s, e] of aiRanges) { pts.add(s); pts.add(e); }
    const sorted = [...pts].filter((p) => p >= 0 && p <= value.length).sort((a, b) => a - b);
    const out: Array<{ text: string; cls: string }> = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (a === b) continue;
      const ai = aiRanges.some(([s, e]) => a >= s && b <= e);
      const dim = focusMode && !ai && (a < start || a >= end);
      out.push({ text: value.slice(a, b), cls: ai ? "g" : dim ? "dim" : "ink" });
    }
    return out;
  }, [value, focusMode, start, end, aiRanges]);

  return (
    <div className="editor" ref={editorRef}>
      {/* Visible text layer (the textarea is transparent). */}
      <div className="textview" aria-hidden="true">
        {runs.map((r, i) => (
          <span key={i} className={r.cls}>{r.text}</span>
        ))}
        {"\n"}
      </div>
      {/* Invisible copy of the text used only to locate the caret pixel position. */}
      <div className="caret-mirror" aria-hidden="true">
        {value.slice(0, caret)}
        <span className="caret-marker" ref={markerRef}>{"​"}</span>
        {value.slice(caret)}
        {"\n"}
      </div>
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        spellCheck
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
          onSelectionChange(e.target.selectionStart ?? 0, e.target.selectionEnd ?? 0);
        }}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {focused && caretPos && (
        <span
          key={`${caret}:${value.length}`}
          className="custom-caret"
          style={{ left: caretPos.left, top: caretPos.top, height: caretPos.height }}
          aria-hidden="true"
        />
      )}
      <Marginalia
        editorRef={editorRef}
        value={value}
        prompts={prompts}
        onMuseGenerate={onMuseGenerate}
        busyPromptId={busyPromptId}
        userAnnos={userAnnos}
        onChangeUserNote={onChangeUserNote}
        onRemoveUserNote={onRemoveUserNote}
        aiSegments={aiSegments}
        onDiscardSegment={onDiscardSegment}
        onHideSegment={onHideSegment}
        showMuse={showMuse}
        showEditor={showEditor}
        showUser={showUser}
        annotateMode={annotateMode}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth screen
// ---------------------------------------------------------------------------
function AuthScreen({ onAuth }: { onAuth: (username: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fn = mode === "login" ? api.login : api.register;
      const res = await fn(username.trim(), password);
      setSession(res.token, res.username);
      onAuth(res.username);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="masthead">
        <div className="brand">Infinibook · a forever-book</div>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
        <label>
          Username
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <div className="chrome">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Register"}
          </button>
          <button
            type="button"
            onClick={() => { setMode(m => m === "login" ? "register" : "login"); setError(null); }}
          >
            {mode === "login" ? "No account? Register" : "Have an account? Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Books listing
// ---------------------------------------------------------------------------
function BooksList({
  username,
  onSelect,
  onSignOut,
}: {
  username: string;
  onSelect: (id: string) => void;
  onSignOut: () => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    api.listBooks().then(setBooks).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Infinibook · a forever-book</span>
          <span style={{ cursor: "pointer" }} onClick={onSignOut}>
            {username} · sign out
          </span>
        </div>
        <h1>Books</h1>
      </header>

      {error && <div className="notice error">{error}</div>}

      {books.map((b) => (
        <div key={b.id} className="book-card" onClick={() => onSelect(b.id)}>
          <div className="book-title">{b.title}</div>
          <div className="book-meta">
            {b.genre} · {b.chapterCount ?? 0} chapters ·{" "}
            {b.claimedBy ? "slot taken" : "open slot"}
          </div>
          <p className="book-premise">{b.premise}</p>
        </div>
      ))}

      {books.length === 0 && !error && (
        <div className="center">No books yet.</div>
      )}

      <hr className="rule" />

      {showNew ? (
        <NewBookForm
          onCreated={(id) => { setShowNew(false); onSelect(id); }}
          onCancel={() => setShowNew(false)}
        />
      ) : (
        <button className="primary" onClick={() => setShowNew(true)}>
          + New book
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New book form
// ---------------------------------------------------------------------------
function NewBookForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [genre, setGenre] = useState("Fiction");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.createBook({ title, premise, genre, visibility });
      onCreated(res.book.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h2>New book</h2>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Premise
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          rows={3}
          required
        />
      </label>
      <label>
        Genre
        <input value={genre} onChange={(e) => setGenre(e.target.value)} />
      </label>
      <label style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={visibility === "private"}
          onChange={(e) => setVisibility(e.target.checked ? "private" : "public")}
        />
        Private (invite only)
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="chrome">
        <button type="submit" className="primary" disabled={busy}>{busy ? "…" : "Create"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Review result panel
// ---------------------------------------------------------------------------
function ReviewResult({ review }: { review: AIReview }) {
  return (
    <div className={`review ${review.decision}`}>
      <div className="verdict">
        {review.decision === "approved" ? "✓ Approved" : "↩ Returned"} — {review.summary}
      </div>
      {review.flags.length > 0 && (
        <div className="flags">
          {review.flags.map((f, i) => (
            <div key={i} className={`flag ${f.severity}`}>
              <span className="tag">{f.kind}</span>
              <span className="msg">{f.message}</span>
              {f.excerpt && <div className="excerpt">"{f.excerpt}"</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes tray — a slide-out scratchpad, persisted per book.
// ---------------------------------------------------------------------------
function NotesTray({ bookId, open, onClose }: { bookId: string; open: boolean; onClose: () => void }) {
  const key = `ib_notes_${bookId}`;
  const [text, setText] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    try { setText(localStorage.getItem(key) || ""); } catch { setText(""); }
  }, [key]);
  useEffect(() => {
    localStorage.setItem(key, text);
  }, [key, text]);
  // Close when clicking anywhere outside the tray (but not on its toggle button).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest(".notes-toggle")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);
  return (
    <aside ref={ref} className={`notes-tray ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="notes-head">
        <span>Notes</span>
        <button className="notes-close" onClick={onClose} aria-label="Close notes">✕</button>
      </div>
      <textarea
        className="notes-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Jot anything — names, threads, reminders. Saved automatically."
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Book view (reader + writer)
// ---------------------------------------------------------------------------
function BookView({
  bookId,
  username,
  onBack,
}: {
  bookId: string;
  username: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prompts, setPrompts] = useState<MusePrompt[]>([]);
  const [review, setReview] = useState<AIReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [focus, setFocus] = useState(false);
  const [showMuse, setShowMuse] = useState(true);
  const [showEditor, setShowEditor] = useState(true);
  const [annotate, setAnnotate] = useState(false);
  const [userAnnos, setUserAnnos] = useState<UserAnno[]>([]);
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const [aiSegments, setAiSegments] = useState<AiSegment[]>([]);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fontId, setFontId } = useFont();

  // Click a Muse idea → the Muse writes a short continuation and weaves it in.
  async function runMuse(promptId: string, suggestion: string) {
    if (busyPromptId) return;
    setBusyPromptId(promptId);
    try {
      const { text } = await api.muse(bookId, suggestion, body);
      const piece = text.trim();
      if (piece) {
        setBody((b) => (b ? `${b.replace(/\s+$/, "")}\n\n${piece}` : piece));
        setAiSegments((segs) => [
          ...segs,
          { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: piece, hidden: false },
        ]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyPromptId(null);
    }
  }
  function discardSegment(id: string) {
    const seg = aiSegments.find((s) => s.id === id);
    if (seg) {
      // Remove the passage from the draft, tidying surrounding whitespace.
      setBody((b) => b.replace(seg.text, "").replace(/\n{3,}/g, "\n\n").replace(/^\s+/, ""));
    }
    setAiSegments((segs) => segs.filter((s) => s.id !== id));
  }
  function hideSegment(id: string) {
    const seg = aiSegments.find((s) => s.id === id);
    if (!seg) return;
    if (!seg.hidden) {
      // Hide: pull the passage out of the draft, remembering where it sat.
      const at = body.indexOf(seg.text);
      if (at >= 0) setBody((b) => b.slice(0, at) + b.slice(at + seg.text.length));
      setAiSegments((segs) =>
        segs.map((s) => (s.id === id ? { ...s, hidden: true, anchor: at < 0 ? body.length : at } : s))
      );
    } else {
      // Show: weave it back in at its anchor.
      const at = Math.min(seg.anchor ?? body.length, body.length);
      setBody((b) => b.slice(0, at) + seg.text + b.slice(at));
      setAiSegments((segs) => segs.map((s) => (s.id === id ? { ...s, hidden: false } : s)));
    }
  }

  const wordCount = useMemo(
    () => (body.trim() ? body.trim().split(/\s+/).length : 0),
    [body]
  );

  // The writer's own annotations persist per book.
  const annoKey = `ib_annos_${bookId}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(annoKey);
      setUserAnnos(saved ? (JSON.parse(saved) as UserAnno[]) : []);
    } catch {
      setUserAnnos([]);
    }
  }, [annoKey]);
  useEffect(() => {
    localStorage.setItem(annoKey, JSON.stringify(userAnnos));
  }, [annoKey, userAnnos]);

  function addUserAnno(kind: UserAnno["kind"]) {
    const [s, e] = sel;
    // underline/circle need a selection; note/arrow can anchor at the caret.
    if ((kind === "underline" || kind === "circle") && s === e) return;
    const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const range: [number, number] = s === e ? [s, s] : [s, e];
    setUserAnnos((prev) => [...prev, { id, kind, range, ...(kind === "note" ? { text: "" } : {}) }]);
    if (!annotate) setAnnotate(true);
  }
  function changeUserNote(id: string, text: string) {
    setUserAnnos((prev) => prev.map((a) => (a.id === id ? { ...a, text } : a)));
  }
  function removeUserNote(id: string) {
    setUserAnnos((prev) => prev.filter((a) => a.id !== id));
  }

  async function load() {
    try {
      setDetail(await api.getBook(bookId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => { load(); }, [bookId]);

  // We track whether the current user holds the claim locally — if they
  // successfully called claim(), they own it until release/approval.
  const [isClaimer, setIsClaimer] = useState(false);

  async function claim() {
    setError(null);
    try {
      await api.claim(bookId);
      setIsClaimer(true);
      const [, p] = await Promise.all([load(), api.prompts(bookId)]);
      setPrompts(p.prompts);
      setReview(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function release() {
    try {
      await api.release(bookId);
      setIsClaimer(false);
      setBody("");
      setTitle("");
      setPrompts([]);
      setReview(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit() {
    setError(null);
    if (!body.trim()) return setError("Write something first.");
    setReviewing(true);
    setReview(null);
    try {
      const res = await api.submit(bookId, {
        title: title.trim() || "Untitled",
        body,
      });
      setReview(res.review);
      if (res.review.decision === "approved") {
        setIsClaimer(false);
        setBody("");
        setTitle("");
        setPrompts([]);
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewing(false);
    }
  }

  if (!detail) {
    return (
      <div className="app">
        <div className="center">{error ? `Error: ${error}` : "Loading…"}</div>
      </div>
    );
  }

  const { book, chapters, nextIndex } = detail;
  const slotTaken = !!book.claimedBy && !isClaimer;

  return (
    <div className={`app ${isClaimer && focus ? "focusmode" : ""}`}>
      <NotesTray bookId={bookId} open={notesOpen} onClose={() => setNotesOpen(false)} />
      <header className="masthead">
        <div className="brand" style={{ display: "flex", justifyContent: "space-between" }}>
          <span
            style={{ cursor: "pointer", textDecoration: "underline" }}
            onClick={onBack}
          >
            ← all books
          </span>
          <span>{username}</span>
        </div>
        <h1>{book.title}</h1>
        <p className="premise">{book.premise}</p>
        <div className="meta">
          {book.genre} · {book.visibility} · {chapters.length} chapters ·{" "}
          {book.claimedBy ? "slot taken" : "open slot"}
        </div>
      </header>

      {chapters.map((c) => (
        <article key={c.id} className="chapter">
          <div className="ch-head">Chapter {c.index}</div>
          <h2>{c.title}</h2>
          {c.body.split(/\n\n+/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
          <div className="byline">— {c.authorName}</div>
        </article>
      ))}

      <hr className="rule" />

      {!isClaimer ? (
        <div>
          <div className="ch-head" style={{ marginBottom: 12 }}>
            Chapter {nextIndex} · unwritten
          </div>
          <div className="chrome">
            <div className="spacer" />
            <button className="primary" onClick={claim} disabled={slotTaken}>
              {slotTaken ? "Slot taken" : "Claim the next chapter"}
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
        </div>
      ) : (
        <div className={`writer ${focus ? "focusmode" : ""}`}>
          <button
            className={`corner-btn focus-toggle ${focus ? "active" : ""}`}
            onClick={() => setFocus((f) => !f)}
            title={`Focus mode: ${focus ? "on" : "off"}`}
            aria-label="Toggle focus mode"
            aria-pressed={focus}
          >
            <Icon name="target" />
          </button>
          <button
            className={`corner-btn muse-toggle ${showMuse ? "active" : ""}`}
            onClick={() => setShowMuse((m) => !m)}
            title={`The Muse (inspiration): ${showMuse ? "on" : "off"}`}
            aria-label="Toggle the Muse"
            aria-pressed={showMuse}
          >
            <Icon name="sparkles" />
          </button>
          <button
            className={`corner-btn editor-toggle ${showEditor ? "active" : ""}`}
            onClick={() => setShowEditor((e) => !e)}
            title={`The Editor (proofing): ${showEditor ? "on" : "off"}`}
            aria-label="Toggle the Editor"
            aria-pressed={showEditor}
          >
            <Icon name="eyeglass" />
          </button>
          <button
            className={`corner-btn annotate-toggle ${annotate ? "active" : ""}`}
            onClick={() => setAnnotate((a) => !a)}
            title={`Your annotations: ${annotate ? "on" : "off"}`}
            aria-label="Toggle your annotations"
            aria-pressed={annotate}
          >
            <Icon name="feather" />
          </button>
          <button
            className={`corner-btn notes-toggle ${notesOpen ? "active" : ""}`}
            onClick={() => setNotesOpen((n) => !n)}
            title={`Notes: ${notesOpen ? "open" : "closed"}`}
            aria-label="Toggle notes tray"
            aria-pressed={notesOpen}
          >
            <Icon name="notebook" />
          </button>
          <div className="ch-head" style={{ marginBottom: 12 }}>
            Chapter {nextIndex} · writing as {username}
          </div>
          <input
            className="title"
            placeholder="Chapter title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <FocusEditor
            value={body}
            onChange={setBody}
            focusMode={focus}
            placeholder="Begin where the story left off…"
            prompts={prompts}
            onMuseGenerate={runMuse}
            busyPromptId={busyPromptId}
            showMuse={showMuse}
            showEditor={showEditor}
            userAnnos={userAnnos}
            onChangeUserNote={changeUserNote}
            onRemoveUserNote={removeUserNote}
            aiSegments={aiSegments}
            onDiscardSegment={discardSegment}
            onHideSegment={hideSegment}
            showUser={annotate}
            annotateMode={annotate}
            onSelectionChange={(s, e) => setSel([s, e])}
          />
          {annotate && (
            <div className="annotate-bar">
              <span className="ann-hint">select text, then</span>
              <button onClick={() => addUserAnno("underline")}>underline</button>
              <button onClick={() => addUserAnno("circle")}>circle</button>
              <button onClick={() => addUserAnno("arrow")}>arrow</button>
              <button onClick={() => addUserAnno("note")}>+ note</button>
              {userAnnos.length > 0 && (
                <button onClick={() => setUserAnnos([])} title="Remove all your marks">
                  clear
                </button>
              )}
            </div>
          )}
          <div className="chrome">
            <span className="count">{wordCount} words</span>
            <select
              className="font-picker"
              value={fontId}
              onChange={(e) => setFontId(e.target.value)}
              title="Writing font"
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <div className="spacer" />
            <button onClick={release}>Release slot</button>
            <button className="primary" onClick={submit} disabled={reviewing}>
              {reviewing ? "Reviewing…" : "Submit for review"}
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
          {review && <ReviewResult review={review} />}
          {review?.decision === "returned" && (
            <div className="notice">
              Your draft is preserved above. Revise and submit again.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell — routing between screens
// ---------------------------------------------------------------------------
type Screen = { name: "auth" } | { name: "books" } | { name: "book"; id: string };

export default function App() {
  const session = getSession();
  const [screen, setScreen] = useState<Screen>(
    session.token ? { name: "books" } : { name: "auth" }
  );
  const [username, setUsername] = useState(session.username ?? "");
  const { theme, toggle } = useTheme();

  function handleAuth(u: string) {
    setUsername(u);
    setScreen({ name: "books" });
  }

  function handleSignOut() {
    clearSession();
    setScreen({ name: "auth" });
  }

  let content;
  if (screen.name === "auth") {
    content = <AuthScreen onAuth={handleAuth} />;
  } else if (screen.name === "books") {
    content = (
      <BooksList
        username={username}
        onSelect={(id) => setScreen({ name: "book", id })}
        onSignOut={handleSignOut}
      />
    );
  } else {
    content = (
      <BookView
        bookId={screen.id}
        username={username}
        onBack={() => setScreen({ name: "books" })}
      />
    );
  }

  return (
    <>
      <button
        className="corner-btn theme-toggle"
        onClick={toggle}
        title="Toggle light / dark"
        aria-label="Toggle light / dark theme"
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} />
      </button>
      {content}
    </>
  );
}
