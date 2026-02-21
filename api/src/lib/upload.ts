import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { allowedMimeTypes, config } from "./config";

fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}_${path.basename(file.originalname)}`;
    cb(null, safeName);
  }
});

export const upload = multer({
  storage,
  limits: {
    fileSize: config.MAX_UPLOAD_BYTES,
    files: 10
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      cb(new Error(`BAD_REQUEST:Unsupported file type ${file.mimetype}`));
      return;
    }
    cb(null, true);
  }
});
