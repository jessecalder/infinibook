// In-memory data store with seed data.
// Prototype-only: resets on every server restart. Swap for Postgres later.

import { randomUUID } from "crypto";
import type { Book, Chapter, BibleEntry } from "./types.js";

export const books: Book[] = [];
export const chapters: Chapter[] = [];
export const bible: BibleEntry[] = [];

export function newId(): string {
  return randomUUID();
}

function seed() {
  const bookId = "book-embergale";
  books.push({
    id: bookId,
    title: "The Embergale Letters",
    premise:
      "In a city where memories can be sealed in glass, a young archivist finds a letter addressed to her that hasn't been written yet.",
    genre: "Literary fantasy",
    visibility: "private",
  });

  const seededChapters: Array<Omit<Chapter, "id" | "bookId" | "createdAt">> = [
    {
      index: 1,
      title: "The Unwritten Letter",
      authorName: "Mara",
      state: "approved",
      approvedAt: new Date().toISOString(),
      body:
        "The archive smelled of cold glass and older dust. Liesl had catalogued seven thousand sealed memories before she found the one with her own name on it — a letter dated three winters from now, in handwriting she did not yet recognize as her own.\n\nShe did not open it. One did not open a memory before its time; that was the first rule of the Embergale. But she carried its weight in her apron pocket all the way home, and it was warm, which no sealed glass had any right to be.",
    },
    {
      index: 2,
      title: "What the Glass Keeps",
      authorName: "Devin",
      state: "approved",
      approvedAt: new Date().toISOString(),
      body:
        "Old Tomas had warned her about warm glass. \"Means the memory's still happening,\" he'd said, tapping his pipe against the cataloguing bench. \"Means somewhere, someone's living it right now — or will be.\"\n\nLiesl spent the evening pretending to read while the letter sat on her windowsill, glowing faintly against the rain. By midnight she had decided two things: she would not open it, and she would find out who had sealed it. The two decisions, she would later realize, were the same decision.",
    },
  ];

  for (const c of seededChapters) {
    chapters.push({
      ...c,
      id: newId(),
      bookId,
      createdAt: new Date().toISOString(),
    });
  }

  const seededBible: Array<Omit<BibleEntry, "id" | "bookId">> = [
    {
      type: "character",
      name: "Liesl",
      detail: "Young archivist at the Embergale. Catalogues sealed memories. Found a letter addressed to her, dated three winters in the future.",
      spoilerScope: 1,
    },
    {
      type: "character",
      name: "Tomas",
      detail: "Old cataloguer, mentor figure. Warns that warm glass means a memory is still happening.",
      spoilerScope: 2,
    },
    {
      type: "fact",
      name: "Sealing rule",
      detail: "One does not open a sealed memory before its time. Warm glass means the memory is still in progress.",
      spoilerScope: 1,
    },
    {
      type: "thread",
      name: "Who sealed the letter?",
      detail: "Open mystery: Liesl wants to find who sealed a letter to her from the future.",
      spoilerScope: 2,
    },
    {
      type: "sealed",
      name: "ENDING — author of the letter",
      detail:
        "Planned reveal (host-sealed): the letter was sealed by Liesl herself, after the events of the book. Must NOT be revealed by the AI or any chapter until unsealed.",
      spoilerScope: 9999,
    },
  ];

  for (const e of seededBible) {
    bible.push({ ...e, id: newId(), bookId });
  }
}

seed();

// --- helpers ---

export function getBook(bookId: string): Book | undefined {
  return books.find((b) => b.id === bookId);
}

export function chaptersForBook(bookId: string): Chapter[] {
  return chapters
    .filter((c) => c.bookId === bookId && c.state === "approved")
    .sort((a, b) => a.index - b.index);
}

export function nextIndex(bookId: string): number {
  const approved = chaptersForBook(bookId);
  return approved.length + 1;
}

export function bibleForBook(bookId: string): BibleEntry[] {
  return bible.filter((e) => e.bookId === bookId);
}
