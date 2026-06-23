import { useEffect, useMemo, useState } from "react";
import { api, getSession, setSession, clearSession } from "./api.js";
import type { Book, BookDetail, AIReview, MusePrompt } from "./types.js";

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
// Muse panel
// ---------------------------------------------------------------------------
function MusePanel({ prompts, onUse }: { prompts: MusePrompt[]; onUse: (text: string) => void }) {
  if (prompts.length === 0) return null;
  return (
    <div className="muse">
      <div className="muse-head">✦ The Muse · optional nudges</div>
      <ul>
        {prompts.map((p) => (
          <li key={p.id} onClick={() => onUse(p.text)} title="Click to use">
            {p.text}
          </li>
        ))}
      </ul>
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
  const [error, setError] = useState<string | null>(null);

  const wordCount = useMemo(
    () => (body.trim() ? body.trim().split(/\s+/).length : 0),
    [body]
  );

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
    <div className="app">
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
          <div className="ch-head" style={{ marginBottom: 12 }}>
            Chapter {nextIndex} · writing as {username}
          </div>
          <input
            className="title"
            placeholder="Chapter title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            placeholder="Begin where the story left off…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
          />
          <div className="chrome">
            <span className="count">{wordCount} words</span>
            <label style={{ cursor: "pointer" }} onClick={() => setFocus((f) => !f)}>
              focus mode: {focus ? "on" : "off"}
            </label>
            <div className="spacer" />
            <button onClick={release}>Release slot</button>
            <button className="primary" onClick={submit} disabled={reviewing}>
              {reviewing ? "Reviewing…" : "Submit for review"}
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
          <MusePanel
            prompts={prompts}
            onUse={(t) => setBody((b) => (b ? b + "\n\n" : "") + `> ${t}\n\n`)}
          />
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

  function handleAuth(u: string) {
    setUsername(u);
    setScreen({ name: "books" });
  }

  function handleSignOut() {
    clearSession();
    setScreen({ name: "auth" });
  }

  if (screen.name === "auth") {
    return <AuthScreen onAuth={handleAuth} />;
  }

  if (screen.name === "books") {
    return (
      <BooksList
        username={username}
        onSelect={(id) => setScreen({ name: "book", id })}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <BookView
      bookId={screen.id}
      username={username}
      onBack={() => setScreen({ name: "books" })}
    />
  );
}
