import { UserJwt } from "../../types";

declare global {
  namespace Express {
    interface Request {
      user?: UserJwt;
    }
  }
}

export {};
