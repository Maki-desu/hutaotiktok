import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
export const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createAdminToken(): string {
  if (!ADMIN_SESSION_SECRET || ADMIN_SESSION_SECRET.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  }
  const payload = Buffer.from(
    JSON.stringify({ expiresAt: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function isValidAdminToken(token: string): boolean {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !ADMIN_SESSION_SECRET) return false;

  const expected = createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payload)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "expiresAt" in parsed &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Date.now()
    );
  } catch {
    return false;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"];
  if (typeof token !== "string" || !isValidAdminToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
