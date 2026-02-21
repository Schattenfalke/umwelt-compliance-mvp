import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { config } from "./lib/config";
import { errorHandler } from "./lib/http";
import { registerRoutes } from "./routes";

export function createApp() {
  const app = express();

  app.use(
    pinoHttp({
      serializers: {
        req(req) {
          return {
            id: (req as { id?: string }).id,
            method: req.method,
            url: req.url
          };
        }
      }
    })
  );
  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));

  registerRoutes(app);
  app.use(errorHandler);

  return app;
}
