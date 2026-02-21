import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/auth";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = header.replace("Bearer ", "").trim();
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (_error) {
    res.status(401).json({ error: "Invalid token" });
  }
}
