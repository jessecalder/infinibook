import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const SECRET = process.env["JWT_SECRET"] ?? "change-me-in-production";
const EXPIRY = "7d";

export interface TokenPayload {
  userId: string;
  username: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRY });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}

// Attaches req.user if a valid Bearer token is present. Never rejects —
// protected routes call requireAuth separately.
export function parseAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      (req as AuthedRequest).user = verifyToken(header.slice(7));
    } catch {
      // invalid token — leave req.user undefined
    }
  }
  next();
}

export interface AuthedRequest extends Request {
  user?: TokenPayload;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!(req as AuthedRequest).user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}
