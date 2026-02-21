import jwt from "jsonwebtoken";
import { config } from "./config";
import { UserJwt } from "../types";

export function signAccessToken(user: UserJwt): string {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: "12h" });
}

export function verifyAccessToken(token: string): UserJwt {
  return jwt.verify(token, config.JWT_SECRET) as UserJwt;
}
