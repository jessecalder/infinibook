// Shared domain types for the Infinibook prototype.

export type ChapterState =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "returned";

export interface Chapter {
  id: string;
  bookId: string;
  index: number; // 1-based position in the canon
  title: string;
  authorName: string;
  body: string;
  state: ChapterState;
  createdAt: string;
  approvedAt?: string;
  review?: AIReview;
}

export interface Book {
  id: string;
  title: string;
  premise: string;
  genre: string;
  visibility: "public" | "private";
  // Prototype claiming model: at most one open slot at a time.
  claimedBy?: string; // author name holding the baton, if any
}

// A single piece of AI feedback attached to a review stage.
export interface AIFlag {
  kind: "proofread" | "continuity" | "spoiler";
  severity: "info" | "suggestion" | "warning" | "block";
  message: string;
  // Optional excerpt the flag refers to.
  excerpt?: string;
}

export interface AIReview {
  decision: "approved" | "returned";
  flags: AIFlag[];
  summary: string;
  reviewedAt: string;
}

// Story-bible entry: the structured canon we retrieve from.
export interface BibleEntry {
  id: string;
  bookId: string;
  type: "character" | "place" | "thread" | "fact" | "sealed";
  name: string;
  detail: string;
  spoilerScope: number; // min chapter index from which this is safe to reveal
}

export interface MusePrompt {
  id: string;
  text: string;
}
