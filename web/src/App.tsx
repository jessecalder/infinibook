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
// Bold line icons for the corner toggles. All inherit `currentColor` so the
// active-state CSS can recolor them.
// ---------------------------------------------------------------------------
function Icon({ name }: { name: "sun" | "moon" | "magnifier" | "bulb" | "glasses" | "pen" }) {
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "sun":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      );
    case "moon":
      return (
        <svg {...p}>
          <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />
        </svg>
      );
    case "magnifier":
      return (
        <svg {...p}>
          <circle cx="10.5" cy="10.5" r="6" />
          <line x1="20" y1="20" x2="15" y2="15" />
        </svg>
      );
    case "bulb":
      return (
        <svg {...p}>
          <path d="M12 2a7 7 0 0 0-4 12.6c.6.5.9 1 1 2.1h6c.1-1.1.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
          <line x1="9.5" y1="21" x2="14.5" y2="21" />
        </svg>
      );
    case "glasses":
      return (
        <svg {...p}>
          <circle cx="6" cy="14" r="3.3" />
          <circle cx="18" cy="14" r="3.3" />
          <path d="M9.3 13.4c.9-1.3 3.7-1.3 4.6 0" />
          <path d="M2.7 12 4.2 8.2" />
          <path d="M21.3 12 19.8 8.2" />
        </svg>
      );
    case "pen":
      return (
        <svg {...p}>
          <path d="M5 19l2.6-.6L19 7l-2-2L5.6 16.4 5 19z" />
          <line x1="14.5" y1="5.5" x2="16.5" y2="7.5" />
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

// The Muse — creative nudges tied to the draft.
function deriveMuse(text: string): Located[] {
  const out: Located[] = [];
  // Circle the last word as a thread to keep pulling (ignoring trailing
  // punctuation / whitespace, so it still lands when a sentence is finished).
  const last = /([A-Za-z'']+)[^A-Za-z'']*$/.exec(text);
  if (last) {
    out.push({
      id: "thread",
      kind: "circle",
      range: [last.index, last.index + last[1].length],
      note: "what does this unlock?",
    });
  }
  return out;
}

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
  onUsePrompt,
  userAnnos,
  onChangeUserNote,
  onRemoveUserNote,
  showMuse,
  showEditor,
  showUser,
  annotateMode,
}: {
  editorRef: RefObject<HTMLDivElement>;
  value: string;
  prompts: MusePrompt[];
  onUsePrompt: (text: string) => void;
  userAnnos: UserAnno[];
  onChangeUserNote: (id: string, text: string) => void;
  onRemoveUserNote: (id: string) => void;
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
      ...deriveMuse(value).map((a) => ({ ...a, source: "muse" as const, text: a.note })),
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
  }, [value, prompts, userAnnos, editorRef]);

  useLayoutEffect(() => { compute(); }, [compute]);
  useEffect(() => {
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
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
        {freeNotes.map((n) => (
          <div
            key={n.id}
            className={`mnote muse general ${n.side} ${!showMuse ? "faded" : ""}`}
            style={{ left: n.x, top: n.y }}
            onClick={() => onUsePrompt(n.text)}
            title={`${n.text} — click to use`}
          >
            {n.text.length > 72 ? `${n.text.slice(0, 72)}…` : n.text}
          </div>
        ))}
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
  onUsePrompt,
  showMuse,
  showEditor,
  userAnnos,
  onChangeUserNote,
  onRemoveUserNote,
  showUser,
  annotateMode,
  onSelectionChange,
}: {
  value: string;
  onChange: (v: string) => void;
  focusMode: boolean;
  placeholder?: string;
  prompts: MusePrompt[];
  onUsePrompt: (text: string) => void;
  showMuse: boolean;
  showEditor: boolean;
  userAnnos: UserAnno[];
  onChangeUserNote: (id: string, text: string) => void;
  onRemoveUserNote: (id: string) => void;
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

  return (
    <div className="editor" ref={editorRef}>
      {focusMode && (
        <div className="backdrop" aria-hidden="true">
          {value.slice(0, start)}
          <span className="active">{value.slice(start, end)}</span>
          {value.slice(end)}
          {"\n"}
        </div>
      )}
      {/* Invisible copy of the text used only to locate the caret pixel position. */}
      <div className="caret-mirror" aria-hidden="true">
        {value.slice(0, caret)}
        <span className="caret-marker" ref={markerRef}>{"​"}</span>
        {value.slice(caret)}
        {"\n"}
      </div>
      <textarea
        ref={ref}
        className={focusMode ? "focus-on" : ""}
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
        onUsePrompt={onUsePrompt}
        userAnnos={userAnnos}
        onChangeUserNote={onChangeUserNote}
        onRemoveUserNote={onRemoveUserNote}
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
  const [error, setError] = useState<string | null>(null);
  const { fontId, setFontId } = useFont();

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
            <Icon name="magnifier" />
          </button>
          <button
            className={`corner-btn muse-toggle ${showMuse ? "active" : ""}`}
            onClick={() => setShowMuse((m) => !m)}
            title={`The Muse (inspiration): ${showMuse ? "on" : "off"}`}
            aria-label="Toggle the Muse"
            aria-pressed={showMuse}
          >
            <Icon name="bulb" />
          </button>
          <button
            className={`corner-btn editor-toggle ${showEditor ? "active" : ""}`}
            onClick={() => setShowEditor((e) => !e)}
            title={`The Editor (proofing): ${showEditor ? "on" : "off"}`}
            aria-label="Toggle the Editor"
            aria-pressed={showEditor}
          >
            <Icon name="glasses" />
          </button>
          <button
            className={`corner-btn annotate-toggle ${annotate ? "active" : ""}`}
            onClick={() => setAnnotate((a) => !a)}
            title={`Your annotations: ${annotate ? "on" : "off"}`}
            aria-label="Toggle your annotations"
            aria-pressed={annotate}
          >
            <Icon name="pen" />
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
            onUsePrompt={(t) => setBody((b) => (b ? b + "\n\n" : "") + `> ${t}\n\n`)}
            showMuse={showMuse}
            showEditor={showEditor}
            userAnnos={userAnnos}
            onChangeUserNote={changeUserNote}
            onRemoveUserNote={removeUserNote}
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
