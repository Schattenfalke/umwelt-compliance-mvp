import { NextFunction, Request, Response } from "express";
import { Permission, hasPermission } from "../lib/rbac";

export function authorize(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!hasPermission(req.user.role, permission)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
