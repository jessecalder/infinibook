# CLAUDE.md — Infinibook

Working notes for this repo. Keep this current as the architecture evolves.

## What it is

Infinibook is a platform for writing a never-ending story together: read the canon → claim the next chapter → write in a focused editor with AI help → submit → AI proofs it → it joins the book. The signature surface is the **writing editor** (an iA Writer–inspired, distraction-free experience). See `README.md` for the original Phase 0 prototype vision.

## Layout & running

Monorepo with npm workspaces:
- `server/` — Express + TypeScript API (port **4000**)
- `web/` — Vite + React + TypeScript (port **5173**, proxies `/api` → 4000)

Run both: `npm run dev` (root). Typecheck: `npm run typecheck` (both workspaces). The repo also has `.claude/launch.json` for the preview tooling (`server`, `web`).

Seed data (`npm --workspace server run seed`): users **mara** / **devin** (password `password`), one book id `book-embergale` with 2 approved chapters + a story bible.

## Backend

- **Persistence**: Prisma 7 + SQLite via the **better-sqlite3 driver adapter**. Several Prisma-7 gotchas:
  - The datasource URL lives in `server/prisma.config.ts`, **not** in `schema.prisma` (`url = env(...)` in the schema is rejected).
  - `PrismaClient` **must** be constructed with an adapter: `new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })` (export is `PrismaBetterSqlite3`, not `PrismaAdapter`). See `server/src/db.ts`.
  - Generated client is TypeScript at `server/src/generated/prisma/client.ts` — import from `./generated/prisma/client.js` (there is no `index.js`).
  - DB file: `server/dev.db` (`DATABASE_URL=file:./dev.db`). To free a stuck writing slot during manual testing: from `server/`, `node -e "const D=require('better-sqlite3');new D('dev.db').prepare(\"UPDATE Book SET claimerId=NULL WHERE id='book-embergale'\").run()"`.
- **Auth**: JWT (`server/src/auth.ts`), bcrypt password hashes. `requireAuth` middleware guards claim/release/submit/muse. Client stores the token in `localStorage` (`ib_token`, `ib_username`).
- **AI** (`server/src/ai/`):
  - `muse.ts` — the interactive Muse's `generateMuseContinuation()`. Uses **Claude (`claude-opus-4-8`) when `ANTHROPIC_API_KEY` is set, otherwise a deterministic mock.** To enable real generation: set `ANTHROPIC_API_KEY` in the server env and restart. Uses `@anthropic-ai/sdk`.
  - `mockAI.ts` — `reviewChapter()` (proof/continuity/spoiler) and `musePrompts()` are still heuristic mocks; the function signatures match what a real LLM service would return.
- Routes are in `server/src/index.ts`. Book/chapter responses use a `BookDetail` shape `{ book, chapters, nextIndex }` — keep create/get consistent or the client throws.

## Frontend — the editor (the subtle part)

**Almost the entire UI lives in `web/src/App.tsx`** with all styling in `web/src/styles.css`. The editor (`FocusEditor`) is layered and easy to break — read this before touching it:

- The `<textarea>` is **transparent** (text and caret). The visible text is rendered by an always-on `.textview` layer, split into runs: `ink` (normal), `dim` (off-focus paragraphs), and `g` (Muse-written passages, rendered as **gradient-clipped glyphs** via `background-clip: text`).
- Several overlay layers must stay **pixel-aligned** (identical typography, `white-space: pre-wrap`, no padding): `.textview`, `.caret-mirror` (locates the custom caret), and `.measure-layer` (full-text node used to measure annotation ranges via DOM `Range.getClientRects()`). The textarea auto-grows so these absolute layers always match.
- **Custom caret**: native caret hidden (`caret-color: transparent`); a `.custom-caret` bar is drawn and positioned from a zero-width marker in `.caret-mirror`. Renders only while the textarea is focused.
- **Focus mode**: dims everything except the current paragraph — paragraph dimming via `.textview` `dim` runs; page chrome via `.app.focusmode` opacity rules. Transitions live on the **base** elements so the fade is symmetric (on *and* off).
- **Marginalia** (`Marginalia` component): hand-drawn-style annotations (SVG + `feTurbulence` displacement filter) measured off `.measure-layer`. Three independently-toggleable, color-coded voices:
  - **Muse** (`--muse-ink`, gold) — creative; lives in the margin only (does **not** mark the prose). Notes fade in/out (`muse-life`); clicking one calls the Muse to generate.
  - **Editor** (`--editor-ink`, red) — objective proofing: wordiness, long sentences, spelling (a small misspelling set).
  - **User** (`--user-ink`, blue) — the writer's own underline/circle/arrow/notes, persisted to `localStorage` per book.
  - Annotation compute is **debounced ~1.2s** so marks settle after you pause, not on every keystroke.
- **Interactive Muse**: clicking a Muse idea → `POST /api/books/:id/muse/generate` → the returned prose is appended to the draft as an `AiSegment` (gradient glyphs). Per-passage chips: **hide** (removes the text, leaves a "✦ show" pill at its anchor), **show** (re-inserts), **discard** (✕).
- **Notes tray** (`NotesTray`): slide-out scratchpad, autosaved to `localStorage` (`ib_notes_<bookId>`); closes on outside click.
- **Corner toggles** (top-right, icon-only): theme (sun/moon), focus (target), Muse (sparkles), Editor (eyeglass), annotate (feather), notes (notebook). Icons are inline SVGs ported from the **Tabler** set ("Writerly" selection). Uniform on/off coloring (faint when off, full ink when on).
- **Font picker** sets the `--editor-font` CSS variable; prefers locally-installed iA Writer fonts, falls back to IBM Plex / Literata (loaded in `web/index.html`).

## Git & workflow

- This directory is its own git repo. Remote `origin` = `github.com/jessecalder/infinibook`, default branch `main`.
- Work on feature branches and open PRs into `main`. `gh` CLI is installed and authenticated (account `jessecalder`); use `gh pr create`. Phase 1 shipped as PR #1.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Testing notes (learned the hard way)

- The preview **screenshot** tool has been flaky this session (stale/blank frames, doesn't always reflect theme/colors). **Verify colors and state with `preview_inspect` / `getComputedStyle` / DOM reads**, not screenshots.
- Programmatic `el.focus()` doesn't reliably trigger React's `onFocus`; use a real `preview_click` or dispatch a bubbling `focusin`. To set a controlled input/textarea value, use the native value setter + dispatch an `input` event.
- Transient `<Marginalia>` React errors in the console during a burst of edits are **HMR mid-edit artifacts** — confirm they're gone after a clean full reload before treating them as real.

## Current state / TODO

- Interactive Muse + Notes tray are built and verified but were **uncommitted** on a feature branch as of this note — check `git status`.
- Marginalia is wide-screen only (hidden below 1200px).
- Faded-out Muse ideas don't yet regenerate (no rotating idea stream).
- The Muse's intended trajectory is a two-way collaborator that discusses ideas and edits the draft (see memory `muse-interactive-goal`).
