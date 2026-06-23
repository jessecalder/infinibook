import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { signToken, parseAuth, requireAuth } from "./auth.js";
import type { AuthedRequest } from "./auth.js";
import { reviewChapter, musePrompts } from "./ai/mockAI.js";
import type { BibleEntry } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(parseAuth);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "username and password required" });
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return res.status(409).json({ error: "Username taken" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { username, passwordHash } });
  const token = signToken({ userId: user.id, username: user.username });
  res.status(201).json({ token, username: user.username });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "username and password required" });
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signToken({ userId: user.id, username: user.username });
  res.json({ token, username: user.username });
});

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------
app.get("/api/books", async (_req, res) => {
  const books = await prisma.book.findMany({
    where: { visibility: "public" },
    include: { _count: { select: { chapters: { where: { state: "approved" } } } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(
    books.map((b) => ({
      id: b.id,
      title: b.title,
      premise: b.premise,
      genre: b.genre,
      visibility: b.visibility,
      chapterCount: b._count.chapters,
      claimedBy: b.claimerId ? "someone" : null,
    }))
  );
});

app.post("/api/books", requireAuth, async (req: AuthedRequest, res) => {
  const { title, premise, genre, visibility } = req.body ?? {};
  if (!title?.trim() || !premise?.trim()) {
    return res.status(400).json({ error: "title and premise required" });
  }
  const book = await prisma.book.create({
    data: {
      title: title.trim(),
      premise: premise.trim(),
      genre: (genre || "Fiction").trim(),
      visibility: visibility === "private" ? "private" : "public",
      hostId: req.user!.userId,
    },
  });
  res.status(201).json(toBookResponse(book, null, 1));
});

app.get("/api/books/:bookId", async (req, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.bookId } });
  if (!book) return res.status(404).json({ error: "Book not found" });

  const chapters = await prisma.chapter.findMany({
    where: { bookId: book.id, state: "approved" },
    include: { author: { select: { username: true } } },
    orderBy: { index: "asc" },
  });

  const nextIndex = chapters.length + 1;
  res.json({
    book: toBookResponse(book, book.claimerId, nextIndex),
    chapters: chapters.map(toChapterResponse),
    nextIndex,
  });
});

// ---------------------------------------------------------------------------
// Claim / Release
// ---------------------------------------------------------------------------
app.post("/api/books/:bookId/claim", requireAuth, async (req: AuthedRequest, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.bookId } });
  if (!book) return res.status(404).json({ error: "Book not found" });

  if (book.claimerId && book.claimerId !== req.user!.userId) {
    return res.status(409).json({ error: "Slot already claimed" });
  }

  const updated = await prisma.book.update({
    where: { id: book.id },
    data: { claimerId: req.user!.userId },
  });

  const chapters = await prisma.chapter.count({ where: { bookId: book.id, state: "approved" } });
  res.json({ book: toBookResponse(updated, updated.claimerId, chapters + 1), nextIndex: chapters + 1 });
});

app.post("/api/books/:bookId/release", requireAuth, async (req: AuthedRequest, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.bookId } });
  if (!book) return res.status(404).json({ error: "Book not found" });
  if (book.claimerId && book.claimerId !== req.user!.userId) {
    return res.status(403).json({ error: "Not your claim" });
  }

  const updated = await prisma.book.update({
    where: { id: book.id },
    data: { claimerId: null },
  });
  res.json({ book: toBookResponse(updated, null, 0) });
});

// ---------------------------------------------------------------------------
// Muse prompts
// ---------------------------------------------------------------------------
app.get("/api/books/:bookId/prompts", async (req, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.bookId } });
  if (!book) return res.status(404).json({ error: "Book not found" });

  const chapters = await prisma.chapter.count({ where: { bookId: book.id, state: "approved" } });
  const entries = await prisma.bibleEntry.findMany({ where: { bookId: book.id } });
  res.json({ prompts: musePrompts(entries as BibleEntry[], chapters) });
});

// ---------------------------------------------------------------------------
// Submit chapter
// ---------------------------------------------------------------------------
app.post("/api/books/:bookId/submit", requireAuth, async (req: AuthedRequest, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.bookId } });
  if (!book) return res.status(404).json({ error: "Book not found" });

  const { title, body } = req.body ?? {};
  if (!body?.trim()) return res.status(400).json({ error: "body required" });

  const entries = await prisma.bibleEntry.findMany({ where: { bookId: book.id } });
  const review = await reviewChapter(body, entries as BibleEntry[]);

  const approvedCount = await prisma.chapter.count({ where: { bookId: book.id, state: "approved" } });

  const chapter = await prisma.chapter.create({
    data: {
      bookId: book.id,
      authorId: req.user!.userId,
      index: approvedCount + 1,
      title: (title || "Untitled").trim(),
      body: body.trim(),
      state: review.decision === "approved" ? "approved" : "returned",
      approvedAt: review.decision === "approved" ? new Date() : null,
      reviewJson: JSON.stringify(review),
    },
    include: { author: { select: { username: true } } },
  });

  if (review.decision === "approved") {
    await prisma.book.update({ where: { id: book.id }, data: { claimerId: null } });
  }

  res.json({ chapter: toChapterResponse(chapter), review });
});

// ---------------------------------------------------------------------------
// Story bible (host/debug)
// ---------------------------------------------------------------------------
app.get("/api/books/:bookId/bible", async (req, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.bookId } });
  if (!book) return res.status(404).json({ error: "Book not found" });
  const entries = await prisma.bibleEntry.findMany({ where: { bookId: book.id } });
  res.json({ entries });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toBookResponse(
  book: { id: string; title: string; premise: string; genre: string; visibility: string },
  claimerId: string | null | undefined,
  nextIndex: number
) {
  return {
    id: book.id,
    title: book.title,
    premise: book.premise,
    genre: book.genre,
    visibility: book.visibility,
    claimedBy: claimerId ?? null,
    nextIndex,
  };
}

function toChapterResponse(chapter: {
  id: string;
  bookId: string;
  index: number;
  title: string;
  body: string;
  state: string;
  createdAt: Date;
  approvedAt: Date | null;
  reviewJson: string | null;
  author: { username: string };
}) {
  return {
    id: chapter.id,
    bookId: chapter.bookId,
    index: chapter.index,
    title: chapter.title,
    authorName: chapter.author.username,
    body: chapter.body,
    state: chapter.state,
    createdAt: chapter.createdAt.toISOString(),
    approvedAt: chapter.approvedAt?.toISOString(),
    review: chapter.reviewJson ? JSON.parse(chapter.reviewJson) : undefined,
  };
}

app.listen(PORT, () => {
  console.log(`Infinibook API listening on http://localhost:${PORT}`);
});

export { app };
