import type { Book, BookDetail, Chapter, AIReview, MusePrompt } from "./types.js";

const base = "/api";

let _token: string | null = localStorage.getItem("ib_token");
let _username: string | null = localStorage.getItem("ib_username");

export function getSession() {
  return { token: _token, username: _username };
}

export function setSession(token: string, username: string) {
  _token = token;
  _username = username;
  localStorage.setItem("ib_token", token);
  localStorage.setItem("ib_username", username);
}

export function clearSession() {
  _token = null;
  _username = null;
  localStorage.removeItem("ib_token");
  localStorage.removeItem("ib_username");
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function authHeaders(): Record<string, string> {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}

export const api = {
  // Auth
  register: (username: string, password: string) =>
    fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(json<{ token: string; username: string }>),

  login: (username: string, password: string) =>
    fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(json<{ token: string; username: string }>),

  // Books
  listBooks: () =>
    fetch(`${base}/books`).then(json<Book[]>),

  getBook: (bookId: string) =>
    fetch(`${base}/books/${bookId}`).then(json<BookDetail>),

  createBook: (payload: { title: string; premise: string; genre: string; visibility: string }) =>
    fetch(`${base}/books`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(json<BookDetail>),

  claim: (bookId: string) =>
    fetch(`${base}/books/${bookId}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
    }).then(json<{ book: Book; nextIndex: number }>),

  release: (bookId: string) =>
    fetch(`${base}/books/${bookId}/release`, {
      method: "POST",
      headers: authHeaders(),
    }).then(json<{ book: Book }>),

  prompts: (bookId: string) =>
    fetch(`${base}/books/${bookId}/prompts`).then(json<{ prompts: MusePrompt[] }>),

  submit: (bookId: string, payload: { title: string; body: string }) =>
    fetch(`${base}/books/${bookId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(json<{ chapter: Chapter; review: AIReview }>),
};
