import type { Request, Response, NextFunction } from "express";

const ADMIN_TOKEN = "hutaotik-admin-token";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "lablabnakohutao";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export { ADMIN_TOKEN };
