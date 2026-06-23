# Infinibook — Prototype (Phase 0)

A first, runnable slice of [Infinibook](../Infinibook-Design-Document.md): a platform for writing a never-ending story together. This prototype proves the **writing feel** and the **core loop** — read the story so far → claim the next chapter → get optional AI nudges → write in a minimal editor → submit → AI proofs it → it joins the canon.

The AI is **mocked**: deterministic heuristics stand in for the Proofreader, Continuity keeper, and Muse described in the design doc. The function signatures match what a real LLM-backed service would return, so going live later means replacing the bodies in `server/src/ai/mockAI.ts`, not the callers.

## What's here

```
infinibook/
├── server/                 Express + TypeScript API
│   └── src/
│       ├── index.ts        routes (books, claim, prompts, submit)
│       ├── store.ts        in-memory data + seed (a 2-chapter book)
│       ├── types.ts        domain types
│       └── ai/mockAI.ts    mocked proof / continuity / spoiler / muse
└── web/                    Vite + React + TypeScript
    └── src/
        ├── App.tsx         reader + minimal editor + claim/submit flow
        ├── styles.css      the iA-Writer-inspired look
        └── api.ts          API client
```

## Run it

Requires Node 18+.

```bash
cd infinibook
npm install          # installs server + web workspaces
npm run dev          # starts API on :4000 and web on :5173
```

Then open **http://localhost:5173**.

(You can also run the two halves separately: `npm run dev:server` and `npm run dev:web`.)

## Try the loop

1. The page opens on **The Embergale Letters** with two seeded chapters.
2. Type your name and **Claim the next chapter**.
3. The **Muse** offers a few optional, spoiler-safe prompts — click one to drop it into your draft, or ignore them.
4. Write a chapter, toggle **focus mode**, then **Submit for review**.
5. The mock AI returns either an **approval** (with optional suggestions) or a **return** with feedback.

### See the guardrails fire

- **Proofreading:** submit something very short, or with `very / really / just` repeated 3+ times, or double  spaces.
- **Continuity:** write a line like *"Liesl opened the sealed letter"* — it contradicts established canon and gets flagged.
- **Spoiler block:** try *"she had sealed it herself"* — this matches the host-sealed ending and is **blocked** (returned) so the reveal stays hidden.

## How the mock maps to the real design

| Prototype (mock) | Real system (design doc §5) |
|---|---|
| `store.ts` in-memory arrays | Postgres + vector canon index |
| `bible[]` seed entries | AI-maintained, host-editable story bible |
| `reviewChapter()` heuristics | LLM orchestration: retrieve canon → proof → continuity → spoiler → decide |
| `musePrompts()` string templates | RAG over open threads, scoped to author's allowed knowledge |
| `spoilerScope` integer | first-class narrative-position + spoiler-scope model |

## Notes / limitations

- Data resets on every server restart (in-memory by design).
- Single seeded book; no auth, groups, or persistence yet — those are Phase 1.
- Claiming is a simple single-slot baton, as specced for the prototype.
