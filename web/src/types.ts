export type ChapterState = "draft" | "submitted" | "in_review" | "approved" | "returned";

export interface Chapter {
  id: string;
  bookId: string;
  index: number;
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
  visibility: string;
  claimedBy: string | null;
  chapterCount?: number;
}

export interface AIFlag {
  kind: "proofread" | "continuity" | "spoiler";
  severity: "info" | "suggestion" | "warning" | "block";
  message: string;
  excerpt?: string;
}

export interface AIReview {
  decision: "approved" | "returned";
  flags: AIFlag[];
  summary: string;
  reviewedAt: string;
}

export interface MusePrompt {
  id: string;
  text: string;
}

export interface BookDetail {
  book: Book;
  chapters: Chapter[];
  nextIndex: number;
}
