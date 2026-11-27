import type { Request, Response, NextFunction } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
export const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
export const ADMIN_APP_KEY = process.env.ADMIN_APP_KEY;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a, "utf8").digest();
  const hashB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(hashA, hashB);
}

export function createAdminToken(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  }
  const payload = Buffer.from(
    JSON.stringify({ expiresAt: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function isValidAdminToken(token: string): boolean {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !secret) return false;

  const expected = createHmac("sha256", secret)
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

export function isValidAdminAppKey(providedKey: string): boolean {
  const trimmed = providedKey.trim();
  if (trimmed.length === 0) return false;

  const configuredAppKey = process.env.ADMIN_APP_KEY?.trim();
  if (configuredAppKey && configuredAppKey.length >= 16) {
    return timingSafeStringEqual(trimmed, configuredAppKey);
  }

  const fallbackPassword = process.env.ADMIN_PASSWORD?.trim();
  if (fallbackPassword && fallbackPassword.length > 0) {
    return timingSafeStringEqual(trimmed, fallbackPassword);
  }

  return false;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const appKey = req.headers["x-admin-key"];
  if (typeof appKey === "string" && isValidAdminAppKey(appKey)) {
    next();
    return;
  }

  const token = req.headers["x-admin-token"];
  if (typeof token === "string" && isValidAdminToken(token)) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}
