import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") });
    return;
  }

  if (error instanceof Error) {
    if (error.message.startsWith("INVALID_TRANSITION:")) {
      res.status(409).json({ error: error.message });
      return;
    }

    if (error.message.startsWith("BAD_REQUEST:")) {
      res.status(400).json({ error: error.message.replace("BAD_REQUEST:", "") });
      return;
    }

    if (error.message.startsWith("NOT_FOUND:")) {
      res.status(404).json({ error: error.message.replace("NOT_FOUND:", "") });
      return;
    }

    if (error.message.startsWith("TOO_MANY_REQUESTS:")) {
      res.status(429).json({ error: error.message.replace("TOO_MANY_REQUESTS:", "") });
      return;
    }
  }

  res.status(500).json({ error: "Internal server error" });
}
