import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  AUTH_DEMO_PASSWORD: z.string().min(1).default("demo123"),
  UPLOAD_DIR: z.string().default("uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  PROOF_UPLOAD_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  PROOF_UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  ALLOWED_MIME_TYPES: z.string().default("image/jpeg,image/png,image/webp"),
  CORS_ORIGIN: z.string().default("http://localhost:3000")
});

export const config = envSchema.parse(process.env);

export const allowedMimeTypes = config.ALLOWED_MIME_TYPES.split(",")
  .map((v) => v.trim())
  .filter((v) => v.length > 0);
