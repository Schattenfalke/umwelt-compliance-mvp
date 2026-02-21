import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import { Express } from "express";
import { z } from "zod";
import { pool } from "../lib/db";
import { signAccessToken } from "../lib/auth";
import { config } from "../lib/config";
import { upload } from "../lib/upload";
import { authenticate } from "../middleware/authenticate";
import { authorize } from "../middleware/authorize";
import { asyncHandler } from "../lib/http";
import { assertTransition } from "../lib/statusMachine";
import { buildValidationFlags, haversineDistanceMeters } from "../lib/geoTimeValidation";
import { writeStatusEvent } from "../lib/audit";
import { checkSlidingWindowRateLimit } from "../lib/rateLimit";
import { ProofPolicy, QaDecision, QA_DECISIONS, Role, TicketStatus } from "../types";

const jpegExif: { fromBuffer: (buffer: Buffer) => Record<string, unknown> | undefined } = require("jpeg-exif");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const ticketCreateSchema = z
  .object({
    project_id: z.string().uuid().nullable().optional(),
    template_id: z.string().uuid().nullable().optional(),
    title: z.string().min(1),
    description: z.string().optional().default(""),
    category: z.string().min(1).optional(),
    task_class: z.number().int().min(1).max(3).optional(),
    location_lat: z.number().min(-90).max(90),
    location_lng: z.number().min(-180).max(180),
    geofence_radius_m: z.number().int().min(5).max(2000).optional(),
    time_window_start: z.string().datetime().nullable().optional(),
    time_window_end: z.string().datetime().nullable().optional(),
    deadline_at: z.string().datetime(),
    proof_policy_json: z.record(z.any()).optional(),
    safety_flags_json: z.record(z.any()).optional().default({})
  })
  .superRefine((value, ctx) => {
    const now = Date.now();
    const deadline = Date.parse(value.deadline_at);

    if (deadline <= now) {
      ctx.addIssue({
        code: "custom",
        message: "deadline_at must be in the future"
      });
    }

    if (value.time_window_start && value.time_window_end) {
      const start = Date.parse(value.time_window_start);
      const end = Date.parse(value.time_window_end);
      if (start > end) {
        ctx.addIssue({
          code: "custom",
          message: "time_window_start must be before time_window_end"
        });
      }
    }
  });

const templateCreateSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  task_class: z.number().int().min(1).max(3),
  checklist_json: z.record(z.any()).optional().default({}),
  proof_policy_json: z.record(z.any()).optional().default({}),
  default_geofence_radius_m: z.number().int().min(5).max(2000).optional().default(25)
});

const templateUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  task_class: z.number().int().min(1).max(3).optional(),
  checklist_json: z.record(z.any()).optional(),
  proof_policy_json: z.record(z.any()).optional(),
  default_geofence_radius_m: z.number().int().min(5).max(2000).optional()
});

const projectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default("")
});

const qualifySchema = z.object({
  task_class: z.number().int().min(1).max(3).optional(),
  proof_policy_json: z.record(z.any()).optional()
});

const qaDecisionSchema = z.object({
  decision: z.enum(QA_DECISIONS),
  comment: z.string().optional().default("")
});

type DbTicket = {
  id: string;
  project_id: string | null;
  creator_user_id: string;
  title: string;
  description: string | null;
  category: string;
  task_class: number;
  status: TicketStatus;
  location_lat: number;
  location_lng: number;
  geofence_radius_m: number;
  time_window_start: string | null;
  time_window_end: string | null;
  deadline_at: string;
  proof_policy_json: Record<string, unknown>;
  safety_flags_json: Record<string, unknown>;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

type DbProof = {
  id: string;
  ticket_id: string;
  submitted_by_user_id: string;
  submitted_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  captured_at: string | null;
  validation_flags_json: Record<string, unknown>;
  checklist_answers_json: Record<string, unknown>;
  notes: string | null;
  qa_status: string;
  qa_decision_at: string | null;
  qa_decision_by: string | null;
  qa_comment: string | null;
  created_at: string;
};

type DbProject = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type DbTemplate = {
  id: string;
  name: string;
  category: string;
  task_class: number;
  checklist_json: Record<string, unknown>;
  proof_policy_json: Record<string, unknown>;
  default_geofence_radius_m: number;
  created_at: string;
};

type DbProofFile = {
  id: string;
  proof_id: string;
  file_key: string;
  file_mime: string;
  file_size: number;
  sha256: string | null;
  created_at: string;
};

function parseJsonObject(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
      throw new Error("must be object");
    }
    return parsed;
  } catch (_error) {
    throw new Error("BAD_REQUEST:Invalid JSON object");
  }
}

function getProofPolicy(raw: unknown): Required<Pick<ProofPolicy, "min_photos" | "require_gps">> & ProofPolicy {
  const policy = (raw ?? {}) as ProofPolicy;
  return {
    min_photos: typeof policy.min_photos === "number" ? policy.min_photos : 1,
    require_gps: typeof policy.require_gps === "boolean" ? policy.require_gps : true,
    redundancy: policy.redundancy,
    required_fields: Array.isArray(policy.required_fields) ? policy.required_fields : []
  };
}

function getRequiredRedundancy(rawPolicy: unknown): number {
  const policy = getProofPolicy(rawPolicy);
  const rawRedundancy = policy.redundancy;
  if (typeof rawRedundancy !== "number" || !Number.isFinite(rawRedundancy)) {
    return 1;
  }
  return Math.max(1, Math.floor(rawRedundancy));
}

function parseOptionalNumberField(value: unknown, fieldName: string): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`BAD_REQUEST:${fieldName} must be a valid number`);
  }
  return parsed;
}

function parseOptionalDateField(value: unknown, fieldName: string): Date | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`BAD_REQUEST:${fieldName} must be a valid datetime`);
  }
  return parsed;
}

function parseExifDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const normalized = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T");
  const withTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = new Date(withTimezone);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function dmsToDecimal(value: unknown, ref: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }

  const deg = Number(value[0]);
  const min = Number(value[1]);
  const sec = Number(value[2]);

  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) {
    return null;
  }

  let decimal = deg + min / 60 + sec / 3600;
  const direction = typeof ref === "string" ? ref.toUpperCase() : "";
  if (direction === "S" || direction === "W") {
    decimal *= -1;
  }
  return decimal;
}

function extractExifMetadata(buffer: Buffer): {
  gpsLat: number | null;
  gpsLng: number | null;
  capturedAt: Date | null;
  hasExif: boolean;
} {
  try {
    const raw = jpegExif.fromBuffer(buffer) ?? {};
    const subExif = (raw.SubExif ?? {}) as Record<string, unknown>;
    const gpsInfo = (raw.GPSInfo ?? {}) as Record<string, unknown>;

    const capturedAt = parseExifDate(subExif.DateTimeOriginal ?? subExif.CreateDate);
    const gpsLat = dmsToDecimal(gpsInfo.GPSLatitude, gpsInfo.GPSLatitudeRef);
    const gpsLng = dmsToDecimal(gpsInfo.GPSLongitude, gpsInfo.GPSLongitudeRef);

    return {
      gpsLat,
      gpsLng,
      capturedAt,
      hasExif: capturedAt != null || gpsLat != null || gpsLng != null
    };
  } catch (_error) {
    return {
      gpsLat: null,
      gpsLng: null,
      capturedAt: null,
      hasExif: false
    };
  }
}

async function getTicketOrThrow(ticketId: string): Promise<DbTicket> {
  const result = await pool.query<DbTicket>("SELECT * FROM tickets WHERE id = $1", [ticketId]);
  const ticket = result.rows[0];
  if (!ticket) {
    throw new Error("NOT_FOUND:Ticket not found");
  }
  return ticket;
}

async function getTemplateOrThrow(templateId: string): Promise<DbTemplate> {
  const result = await pool.query<DbTemplate>("SELECT * FROM ticket_templates WHERE id = $1", [templateId]);
  const template = result.rows[0];
  if (!template) {
    throw new Error("NOT_FOUND:Template not found");
  }
  return template;
}

async function listProofsByTicket(ticketId: string): Promise<Array<DbProof & { files: Array<Record<string, unknown>> }>> {
  const proofsResult = await pool.query<DbProof>(
    "SELECT * FROM proofs WHERE ticket_id = $1 ORDER BY created_at DESC",
    [ticketId]
  );

  const proofs = [] as Array<DbProof & { files: Array<Record<string, unknown>> }>;
  for (const proof of proofsResult.rows) {
    const filesResult = await pool.query(
      "SELECT id, file_key, file_mime, file_size, sha256, created_at FROM proof_files WHERE proof_id = $1 ORDER BY created_at ASC",
      [proof.id]
    );
    proofs.push({ ...proof, files: filesResult.rows });
  }

  return proofs;
}

function checkCommentRequired(decision: QaDecision, comment: string): void {
  if ((decision === "REQUEST_CHANGES" || decision === "REJECT" || decision === "ESCALATE") && !comment.trim()) {
    throw new Error("BAD_REQUEST:comment is required for this decision");
  }
}

async function transitionTicketStatus(params: {
  ticketId: string;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  actorUserId: string;
  eventType?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  assertTransition(params.fromStatus, params.toStatus);
  const update = await pool.query(
    "UPDATE tickets SET status = $1 WHERE id = $2 AND status = $3 RETURNING id",
    [params.toStatus, params.ticketId, params.fromStatus]
  );
  if (!update.rows[0]) {
    throw new Error("BAD_REQUEST:Ticket status changed concurrently");
  }
  await writeStatusEvent({
    ticketId: params.ticketId,
    actorUserId: params.actorUserId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    eventType: params.eventType ?? "STATUS_CHANGE",
    payload: params.payload
  });
}

export function registerRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      const payload = loginSchema.parse(req.body);

      if (payload.password !== config.AUTH_DEMO_PASSWORD) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const userResult = await pool.query<{ id: string; email: string; role: Role }>(
        "SELECT id, email, role FROM users WHERE email = $1",
        [payload.email]
      );

      const user = userResult.rows[0];
      if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role });
      res.json({ access_token: accessToken });
    })
  );

  app.use(authenticate);

  app.get(
    "/projects",
    authorize("project:list"),
    asyncHandler(async (req, res) => {
      if (req.user?.role === "REQUESTER") {
        const ownProjects = await pool.query<DbProject>(
          "SELECT * FROM projects WHERE owner_user_id = $1 ORDER BY created_at DESC",
          [req.user.id]
        );
        res.json(ownProjects.rows);
        return;
      }

      const projects = await pool.query<DbProject>("SELECT * FROM projects ORDER BY created_at DESC");
      res.json(projects.rows);
    })
  );

  app.post(
    "/projects",
    authorize("project:create"),
    asyncHandler(async (req, res) => {
      const payload = projectCreateSchema.parse(req.body);
      const created = await pool.query<DbProject>(
        `
        INSERT INTO projects (owner_user_id, name, description)
        VALUES ($1,$2,$3)
        RETURNING *
        `,
        [req.user!.id, payload.name, payload.description]
      );
      res.status(201).json(created.rows[0]);
    })
  );

  app.get(
    "/admin/users",
    authorize("admin:users:read"),
    asyncHandler(async (_req, res) => {
      const users = await pool.query(
        "SELECT id, email, display_name, role, is_verified, created_at FROM users ORDER BY created_at ASC"
      );
      res.json(users.rows);
    })
  );

  app.patch(
    "/admin/users/:userId/role",
    authorize("admin:users:write"),
    asyncHandler(async (req, res) => {
      const roleSchema = z.object({ role: z.enum(["ADMIN", "REQUESTER", "WORKER", "QA"]) });
      const payload = roleSchema.parse(req.body);
      const result = await pool.query(
        "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, display_name, role, is_verified, created_at",
        [payload.role, req.params.userId]
      );

      if (!result.rows[0]) {
        throw new Error("NOT_FOUND:User not found");
      }

      res.json(result.rows[0]);
    })
  );

  app.get(
    "/admin/metrics",
    authorize("admin:metrics:read"),
    asyncHandler(async (_req, res) => {
      const totalsResult = await pool.query<{
        total_tickets: string;
        total_proofs: string;
        qa_decided_proofs: string;
      }>(
        `
        SELECT
          (SELECT COUNT(*)::text FROM tickets) AS total_tickets,
          (SELECT COUNT(*)::text FROM proofs) AS total_proofs,
          (SELECT COUNT(*)::text FROM proofs WHERE qa_decision_at IS NOT NULL) AS qa_decided_proofs
        `
      );

      const medianResult = await pool.query<{ median_seconds: string | null }>(
        `
        SELECT
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (accepted_at - created_at))
          )::text AS median_seconds
        FROM tickets
        WHERE accepted_at IS NOT NULL
        `
      );

      const firstPassResult = await pool.query<{
        total_decided_first: string;
        approved_first: string;
      }>(
        `
        WITH first_proofs AS (
          SELECT DISTINCT ON (ticket_id) ticket_id, qa_status
          FROM proofs
          ORDER BY ticket_id, created_at ASC
        )
        SELECT
          COUNT(*) FILTER (WHERE qa_status IN ('APPROVED','CHANGES_REQUESTED','REJECTED'))::text AS total_decided_first,
          COUNT(*) FILTER (WHERE qa_status = 'APPROVED')::text AS approved_first
        FROM first_proofs
        `
      );

      const qaCycleResult = await pool.query<{ avg_seconds: string | null }>(
        `
        SELECT AVG(EXTRACT(EPOCH FROM (qa_decision_at - submitted_at)))::text AS avg_seconds
        FROM proofs
        WHERE qa_decision_at IS NOT NULL
        `
      );

      const changeRateResult = await pool.query<{
        requested_count: string;
        total_decisions: string;
      }>(
        `
        SELECT
          COUNT(*) FILTER (WHERE qa_status = 'CHANGES_REQUESTED')::text AS requested_count,
          COUNT(*) FILTER (WHERE qa_status IN ('APPROVED','CHANGES_REQUESTED','REJECTED'))::text AS total_decisions
        FROM proofs
        `
      );

      const totals = totalsResult.rows[0];
      const firstPass = firstPassResult.rows[0];
      const changeRate = changeRateResult.rows[0];

      const firstPassDenominator = Number(firstPass.total_decided_first);
      const changeRateDenominator = Number(changeRate.total_decisions);

      res.json({
        generated_at: new Date().toISOString(),
        totals: {
          tickets: Number(totals.total_tickets),
          proofs: Number(totals.total_proofs),
          qa_decided_proofs: Number(totals.qa_decided_proofs)
        },
        kpis: {
          median_ticket_to_accepted_seconds:
            medianResult.rows[0].median_seconds == null ? null : Number(medianResult.rows[0].median_seconds),
          first_pass_proof_complete_rate:
            firstPassDenominator > 0 ? Number(firstPass.approved_first) / firstPassDenominator : null,
          avg_qa_cycle_seconds:
            qaCycleResult.rows[0].avg_seconds == null ? null : Number(qaCycleResult.rows[0].avg_seconds),
          change_request_rate:
            changeRateDenominator > 0 ? Number(changeRate.requested_count) / changeRateDenominator : null
        }
      });
    })
  );

  app.get(
    "/templates",
    authorize("template:list"),
    asyncHandler(async (_req, res) => {
      const result = await pool.query<DbTemplate>("SELECT * FROM ticket_templates ORDER BY created_at DESC");
      res.json(result.rows);
    })
  );

  app.get(
    "/qa/queue",
    authorize("proof:qa"),
    asyncHandler(async (req, res) => {
      const flag = typeof req.query.flag === "string" ? req.query.flag : null;
      const whereParts = ["t.status = 'PROOF_SUBMITTED'", "p.qa_status = 'PENDING'"];

      if (flag === "geo_fail") {
        whereParts.push("COALESCE((p.validation_flags_json->>'geofence_ok')::boolean, false) = false");
      } else if (flag === "time_fail") {
        whereParts.push("COALESCE((p.validation_flags_json->>'time_ok')::boolean, false) = false");
      } else if (flag === "exif_missing") {
        whereParts.push("COALESCE((p.validation_flags_json->>'exif_present')::boolean, false) = false");
      } else if (flag != null && flag !== "all") {
        throw new Error("BAD_REQUEST:Unsupported QA queue flag filter");
      }

      const result = await pool.query(
        `
        SELECT
          p.id AS proof_id,
          p.ticket_id,
          t.title AS ticket_title,
          t.category,
          p.submitted_by_user_id,
          p.submitted_at,
          p.validation_flags_json,
          p.qa_status
        FROM proofs p
        JOIN tickets t ON t.id = p.ticket_id
        WHERE ${whereParts.join(" AND ")}
        ORDER BY p.submitted_at DESC
        `
      );

      res.json(result.rows);
    })
  );

  app.get(
    "/proofs/:proofId/files/:fileId",
    authorize("proof:qa"),
    asyncHandler(async (req, res) => {
      const proofResult = await pool.query<Pick<DbProof, "id" | "ticket_id">>(
        "SELECT id, ticket_id FROM proofs WHERE id = $1",
        [req.params.proofId]
      );
      const proof = proofResult.rows[0];
      if (!proof) {
        throw new Error("NOT_FOUND:Proof not found");
      }

      const fileResult = await pool.query<DbProofFile>(
        "SELECT * FROM proof_files WHERE id = $1 AND proof_id = $2",
        [req.params.fileId, req.params.proofId]
      );
      const file = fileResult.rows[0];
      if (!file) {
        throw new Error("NOT_FOUND:Proof file not found");
      }

      await getTicketOrThrow(proof.ticket_id);

      const uploadDir = path.resolve(config.UPLOAD_DIR);
      const absolutePath = path.resolve(uploadDir, path.basename(file.file_key));

      if (!absolutePath.startsWith(uploadDir)) {
        throw new Error("BAD_REQUEST:Invalid file path");
      }
      if (!fs.existsSync(absolutePath)) {
        throw new Error("NOT_FOUND:Stored file not found");
      }

      res.setHeader("Content-Type", file.file_mime);
      res.setHeader("Content-Disposition", `inline; filename=${path.basename(file.file_key)}`);
      res.setHeader("Content-Length", String(file.file_size));

      const stream = fs.createReadStream(absolutePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    })
  );

  app.post(
    "/templates",
    authorize("template:write"),
    asyncHandler(async (req, res) => {
      const payload = templateCreateSchema.parse(req.body);
      const result = await pool.query<DbTemplate>(
        `
        INSERT INTO ticket_templates (
          name,
          category,
          task_class,
          checklist_json,
          proof_policy_json,
          default_geofence_radius_m
        )
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
        RETURNING *
        `,
        [
          payload.name,
          payload.category,
          payload.task_class,
          JSON.stringify(payload.checklist_json),
          JSON.stringify(payload.proof_policy_json),
          payload.default_geofence_radius_m
        ]
      );

      res.status(201).json(result.rows[0]);
    })
  );

  app.patch(
    "/templates/:templateId",
    authorize("template:write"),
    asyncHandler(async (req, res) => {
      const payload = templateUpdateSchema.parse(req.body ?? {});
      const hasAnyUpdate =
        payload.name !== undefined ||
        payload.category !== undefined ||
        payload.task_class !== undefined ||
        payload.checklist_json !== undefined ||
        payload.proof_policy_json !== undefined ||
        payload.default_geofence_radius_m !== undefined;

      if (!hasAnyUpdate) {
        throw new Error("BAD_REQUEST:No template fields provided for update");
      }

      const result = await pool.query<DbTemplate>(
        `
        UPDATE ticket_templates
        SET
          name = COALESCE($1, name),
          category = COALESCE($2, category),
          task_class = COALESCE($3, task_class),
          checklist_json = CASE WHEN $4::jsonb IS NULL THEN checklist_json ELSE $4::jsonb END,
          proof_policy_json = CASE WHEN $5::jsonb IS NULL THEN proof_policy_json ELSE $5::jsonb END,
          default_geofence_radius_m = COALESCE($6, default_geofence_radius_m)
        WHERE id = $7
        RETURNING *
        `,
        [
          payload.name ?? null,
          payload.category ?? null,
          payload.task_class ?? null,
          payload.checklist_json ? JSON.stringify(payload.checklist_json) : null,
          payload.proof_policy_json ? JSON.stringify(payload.proof_policy_json) : null,
          payload.default_geofence_radius_m ?? null,
          req.params.templateId
        ]
      );

      if (!result.rows[0]) {
        throw new Error("NOT_FOUND:Template not found");
      }

      res.json(result.rows[0]);
    })
  );

  app.delete(
    "/templates/:templateId",
    authorize("template:write"),
    asyncHandler(async (req, res) => {
      const result = await pool.query<{ id: string }>("DELETE FROM ticket_templates WHERE id = $1 RETURNING id", [
        req.params.templateId
      ]);
      if (!result.rows[0]) {
        throw new Error("NOT_FOUND:Template not found");
      }
      res.status(204).send();
    })
  );

  app.get(
    "/tickets",
    authorize("ticket:list"),
    asyncHandler(async (req, res) => {
      const statusFilter = typeof req.query.status === "string" ? req.query.status : null;
      const projectFilter = typeof req.query.project_id === "string" ? req.query.project_id : null;
      const nearLat = typeof req.query.near_lat === "string" ? Number(req.query.near_lat) : null;
      const nearLng = typeof req.query.near_lng === "string" ? Number(req.query.near_lng) : null;
      const nearRadiusKm =
        typeof req.query.near_radius_km === "string" ? Number(req.query.near_radius_km) : 10;

      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (statusFilter) {
        params.push(statusFilter);
        whereParts.push(`status = $${params.length}`);
      }

      if (projectFilter) {
        params.push(projectFilter);
        whereParts.push(`project_id = $${params.length}`);
      }

      if (req.user?.role === "WORKER" && !statusFilter) {
        params.push(req.user.id);
        whereParts.push(`(status = 'PUBLISHED' OR (status IN ('ACCEPTED', 'NEEDS_CHANGES') AND accepted_by_user_id = $${params.length}))`);
      }

      const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const result = await pool.query<DbTicket>(`SELECT * FROM tickets ${whereClause} ORDER BY created_at DESC`, params);

      let rows = result.rows;
      if (nearLat != null && nearLng != null && Number.isFinite(nearLat) && Number.isFinite(nearLng)) {
        const distancedRows: Array<DbTicket & { _distance_m: number }> = rows
          .map((row: DbTicket) => ({
            ...row,
            _distance_m: haversineDistanceMeters(nearLat, nearLng, row.location_lat, row.location_lng)
          }))
          .filter((row: DbTicket & { _distance_m: number }) => row._distance_m <= nearRadiusKm * 1000)
          .sort(
            (a: DbTicket & { _distance_m: number }, b: DbTicket & { _distance_m: number }) =>
              a._distance_m - b._distance_m
          );

        rows = distancedRows;
      }

      res.json(rows);
    })
  );

  app.post(
    "/tickets",
    authorize("ticket:create"),
    asyncHandler(async (req, res) => {
      const payload = ticketCreateSchema.parse(req.body);
      const template = payload.template_id ? await getTemplateOrThrow(payload.template_id) : null;

      const category = payload.category ?? template?.category;
      const taskClass = payload.task_class ?? template?.task_class;
      const geofenceRadiusM = payload.geofence_radius_m ?? template?.default_geofence_radius_m;
      const proofPolicy = payload.proof_policy_json ?? template?.proof_policy_json ?? {};

      if (!category) {
        throw new Error("BAD_REQUEST:category is required");
      }
      if (!taskClass) {
        throw new Error("BAD_REQUEST:task_class is required");
      }
      if (!geofenceRadiusM) {
        throw new Error("BAD_REQUEST:geofence_radius_m is required");
      }

      const insertResult = await pool.query<DbTicket>(
        `
        INSERT INTO tickets (
          project_id,
          creator_user_id,
          title,
          description,
          category,
          task_class,
          status,
          location_lat,
          location_lng,
          geofence_radius_m,
          time_window_start,
          time_window_end,
          deadline_at,
          proof_policy_json,
          safety_flags_json
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,'NEW',$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb
        )
        RETURNING *
        `,
        [
          payload.project_id ?? null,
          req.user!.id,
          payload.title,
          payload.description,
          category,
          taskClass,
          payload.location_lat,
          payload.location_lng,
          geofenceRadiusM,
          payload.time_window_start ?? null,
          payload.time_window_end ?? null,
          payload.deadline_at,
          JSON.stringify(proofPolicy),
          JSON.stringify(payload.safety_flags_json)
        ]
      );

      const ticket = insertResult.rows[0];
      await writeStatusEvent({
        ticketId: ticket.id,
        actorUserId: req.user!.id,
        fromStatus: null,
        toStatus: "NEW",
        eventType: "STATUS_CHANGE",
        payload: {
          reason: "ticket_created",
          template_id: template?.id ?? null
        }
      });

      res.status(201).json(ticket);
    })
  );

  app.get(
    "/tickets/:ticketId",
    authorize("ticket:detail"),
    asyncHandler(async (req, res) => {
      const ticket = await getTicketOrThrow(req.params.ticketId);
      const proofs = await listProofsByTicket(ticket.id);
      const eventsResult = await pool.query(
        "SELECT * FROM status_events WHERE ticket_id = $1 ORDER BY created_at ASC",
        [ticket.id]
      );

      res.json({ ...ticket, proofs, status_events: eventsResult.rows });
    })
  );

  app.post(
    "/tickets/:ticketId/qualify",
    authorize("ticket:qualify"),
    asyncHandler(async (req, res) => {
      const payload = qualifySchema.parse(req.body ?? {});
      const ticket = await getTicketOrThrow(req.params.ticketId);

      await transitionTicketStatus({
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: "QUALIFIED",
        actorUserId: req.user!.id,
        payload
      });

      await pool.query(
        `
        UPDATE tickets
        SET task_class = COALESCE($1, task_class),
            proof_policy_json = CASE WHEN $2::jsonb IS NULL THEN proof_policy_json ELSE $2::jsonb END
        WHERE id = $3
        `,
        [payload.task_class ?? null, payload.proof_policy_json ? JSON.stringify(payload.proof_policy_json) : null, ticket.id]
      );

      const updated = await getTicketOrThrow(ticket.id);
      res.json(updated);
    })
  );

  app.post(
    "/tickets/:ticketId/publish",
    authorize("ticket:publish"),
    asyncHandler(async (req, res) => {
      const ticket = await getTicketOrThrow(req.params.ticketId);
      await transitionTicketStatus({
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: "PUBLISHED",
        actorUserId: req.user!.id
      });
      const updated = await getTicketOrThrow(ticket.id);
      res.json(updated);
    })
  );

  app.post(
    "/tickets/:ticketId/accept",
    authorize("ticket:accept"),
    asyncHandler(async (req, res) => {
      const actorId = req.user!.id;
      const isWorker = req.user!.role === "WORKER";

      if (isWorker) {
        const activeResult = await pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM tickets WHERE status = 'ACCEPTED' AND accepted_by_user_id = $1",
          [actorId]
        );
        if (Number(activeResult.rows[0].count) > 0) {
          throw new Error("BAD_REQUEST:Worker already has an active accepted ticket");
        }
      }

      const current = await getTicketOrThrow(req.params.ticketId);
      assertTransition(current.status, "ACCEPTED");

      const update = await pool.query<DbTicket>(
        `
        UPDATE tickets
        SET status = 'ACCEPTED',
            accepted_by_user_id = $1,
            accepted_at = now()
        WHERE id = $2
          AND status = 'PUBLISHED'
          AND accepted_by_user_id IS NULL
        RETURNING *
        `,
        [actorId, current.id]
      );

      const updated = update.rows[0];
      if (!updated) {
        throw new Error("BAD_REQUEST:Ticket already accepted");
      }

      await writeStatusEvent({
        ticketId: current.id,
        actorUserId: actorId,
        fromStatus: current.status,
        toStatus: "ACCEPTED",
        eventType: "STATUS_CHANGE"
      });

      res.json(updated);
    })
  );

  app.post(
    "/tickets/:ticketId/proofs",
    authorize("proof:submit"),
    upload.array("files", 10),
    asyncHandler(async (req, res) => {
      const ticket = await getTicketOrThrow(req.params.ticketId);

      if (!["ACCEPTED", "NEEDS_CHANGES", "PROOF_SUBMITTED"].includes(ticket.status)) {
        throw new Error("BAD_REQUEST:Ticket is not ready for proof submission");
      }

      if (req.user!.role === "WORKER" && ticket.accepted_by_user_id !== req.user!.id) {
        throw new Error("BAD_REQUEST:Only the assigned worker can submit proof");
      }

      const limitKey = `proof-upload:${req.user!.id}:${req.ip ?? "unknown"}`;
      const rateLimit = checkSlidingWindowRateLimit({
        key: limitKey,
        windowSec: config.PROOF_UPLOAD_RATE_LIMIT_WINDOW_SEC,
        maxRequests: config.PROOF_UPLOAD_RATE_LIMIT_MAX
      });
      if (!rateLimit.allowed) {
        throw new Error(
          `TOO_MANY_REQUESTS:Proof upload rate limit exceeded. Retry in ${rateLimit.retryAfterSec} second(s).`
        );
      }

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const checklistRaw = req.body.checklist_answers_json as string | undefined;
      if (!checklistRaw) {
        throw new Error("BAD_REQUEST:checklist_answers_json is required");
      }

      const checklistAnswers = parseJsonObject(checklistRaw);
      const notes = (req.body.notes as string | undefined) ?? "";
      let gpsLat = parseOptionalNumberField(req.body.gps_lat, "gps_lat");
      let gpsLng = parseOptionalNumberField(req.body.gps_lng, "gps_lng");
      let capturedAt = parseOptionalDateField(req.body.captured_at, "captured_at");
      const submittedAt = new Date();
      let exifPresent = false;

      const policy = getProofPolicy(ticket.proof_policy_json);
      if (files.length < policy.min_photos) {
        throw new Error(`BAD_REQUEST:At least ${policy.min_photos} photo(s) required`);
      }

      if (Array.isArray(policy.required_fields) && policy.required_fields.length > 0) {
        for (const field of policy.required_fields) {
          const value = checklistAnswers[field];
          if (value === undefined || value === null || value === "") {
            throw new Error(`BAD_REQUEST:Missing required checklist field '${field}'`);
          }
        }
      }

      const preparedFiles: Array<{
        fileKey: string;
        fileMime: string;
        fileSize: number;
        sha256: string;
      }> = [];

      for (const file of files) {
        const fileBuffer = fs.readFileSync(file.path);
        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        const exifMeta = extractExifMetadata(fileBuffer);

        exifPresent = exifPresent || exifMeta.hasExif;
        if (gpsLat == null && exifMeta.gpsLat != null) {
          gpsLat = exifMeta.gpsLat;
        }
        if (gpsLng == null && exifMeta.gpsLng != null) {
          gpsLng = exifMeta.gpsLng;
        }
        if (capturedAt == null && exifMeta.capturedAt != null) {
          capturedAt = exifMeta.capturedAt;
        }

        preparedFiles.push({
          fileKey: path.basename(file.path),
          fileMime: file.mimetype,
          fileSize: file.size,
          sha256
        });
      }

      const validationFlags = buildValidationFlags({
        ticketLat: ticket.location_lat,
        ticketLng: ticket.location_lng,
        proofLat: gpsLat,
        proofLng: gpsLng,
        geofenceRadiusM: ticket.geofence_radius_m,
        requireGps: policy.require_gps,
        timeWindowStart: ticket.time_window_start ? new Date(ticket.time_window_start) : null,
        timeWindowEnd: ticket.time_window_end ? new Date(ticket.time_window_end) : null,
        deadlineAt: new Date(ticket.deadline_at),
        capturedAt,
        submittedAt,
        exifPresent
      });

      const proofResult = await pool.query<DbProof>(
        `
        INSERT INTO proofs (
          ticket_id,
          submitted_by_user_id,
          gps_lat,
          gps_lng,
          captured_at,
          validation_flags_json,
          checklist_answers_json,
          notes,
          qa_status
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'PENDING')
        RETURNING *
        `,
        [
          ticket.id,
          req.user!.id,
          gpsLat,
          gpsLng,
          capturedAt ? capturedAt.toISOString() : null,
          JSON.stringify(validationFlags),
          JSON.stringify(checklistAnswers),
          notes
        ]
      );

      const proof = proofResult.rows[0];

      const insertedFiles: Array<Record<string, unknown>> = [];
      for (const file of preparedFiles) {
        const fileResult = await pool.query(
          `
          INSERT INTO proof_files (proof_id, file_key, file_mime, file_size, sha256)
          VALUES ($1,$2,$3,$4,$5)
          RETURNING id, file_key, file_mime, file_size, sha256, created_at
          `,
          [proof.id, file.fileKey, file.fileMime, file.fileSize, file.sha256]
        );
        insertedFiles.push(fileResult.rows[0]);
      }

      if (ticket.status === "PROOF_SUBMITTED") {
        await writeStatusEvent({
          ticketId: ticket.id,
          actorUserId: req.user!.id,
          fromStatus: ticket.status,
          toStatus: ticket.status,
          eventType: "PROOF_ADDED",
          payload: { proof_id: proof.id, validation_flags_json: validationFlags }
        });
      } else {
        await transitionTicketStatus({
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: "PROOF_SUBMITTED",
          actorUserId: req.user!.id,
          payload: { proof_id: proof.id, validation_flags_json: validationFlags }
        });
      }

      res.status(201).json({ ...proof, files: insertedFiles });
    })
  );

  app.post(
    "/proofs/:proofId/qa",
    authorize("proof:qa"),
    asyncHandler(async (req, res) => {
      const payload = qaDecisionSchema.parse(req.body);
      checkCommentRequired(payload.decision, payload.comment);

      const proofResult = await pool.query<DbProof>("SELECT * FROM proofs WHERE id = $1", [req.params.proofId]);
      const proof = proofResult.rows[0];
      if (!proof) {
        throw new Error("NOT_FOUND:Proof not found");
      }

      const ticket = await getTicketOrThrow(proof.ticket_id);
      if (ticket.status !== "PROOF_SUBMITTED") {
        throw new Error("BAD_REQUEST:Ticket not in PROOF_SUBMITTED state");
      }

      let nextTicketStatus: TicketStatus | null = null;
      let nextQaStatus: string;
      const requiredRedundancy = getRequiredRedundancy(ticket.proof_policy_json);

      switch (payload.decision) {
        case "APPROVE": {
          nextQaStatus = "APPROVED";
          break;
        }
        case "REQUEST_CHANGES": {
          nextTicketStatus = "NEEDS_CHANGES";
          nextQaStatus = "CHANGES_REQUESTED";
          break;
        }
        case "REJECT": {
          nextTicketStatus = "REJECTED";
          nextQaStatus = "REJECTED";
          break;
        }
        case "ESCALATE": {
          nextTicketStatus = "REJECTED";
          nextQaStatus = "REJECTED";
          break;
        }
      }

      await pool.query(
        `
        UPDATE proofs
        SET qa_status = $1,
            qa_decision_at = now(),
            qa_decision_by = $2,
            qa_comment = $3
        WHERE id = $4
        `,
        [nextQaStatus, req.user!.id, payload.comment, proof.id]
      );

      if (payload.decision === "APPROVE") {
        const approvedCountResult = await pool.query<{ approved_count: string }>(
          "SELECT COUNT(*)::text AS approved_count FROM proofs WHERE ticket_id = $1 AND qa_status = 'APPROVED'",
          [ticket.id]
        );
        const approvedCount = Number(approvedCountResult.rows[0]?.approved_count ?? "0");

        if (approvedCount >= requiredRedundancy) {
          await transitionTicketStatus({
            ticketId: ticket.id,
            fromStatus: ticket.status,
            toStatus: "COMPLETED",
            actorUserId: req.user!.id,
            eventType: "QA_DECISION",
            payload: {
              proof_id: proof.id,
              decision: payload.decision,
              comment: payload.comment,
              approved_count: approvedCount,
              redundancy_required: requiredRedundancy
            }
          });
        } else {
          await writeStatusEvent({
            ticketId: ticket.id,
            actorUserId: req.user!.id,
            fromStatus: ticket.status,
            toStatus: ticket.status,
            eventType: "QA_DECISION",
            payload: {
              proof_id: proof.id,
              decision: payload.decision,
              comment: payload.comment,
              approved_count: approvedCount,
              redundancy_required: requiredRedundancy,
              pending_redundancy: true
            }
          });
        }
      } else {
        await transitionTicketStatus({
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: nextTicketStatus!,
          actorUserId: req.user!.id,
          eventType: "QA_DECISION",
          payload: {
            proof_id: proof.id,
            decision: payload.decision,
            comment: payload.comment
          }
        });
      }

      if (payload.decision === "ESCALATE") {
        const escalatedTitle = `[ESCALATION] ${ticket.title}`;
        const escalationPayload = {
          source_ticket_id: ticket.id,
          reason: payload.comment
        };

        const created = await pool.query<DbTicket>(
          `
          INSERT INTO tickets (
            project_id,
            creator_user_id,
            title,
            description,
            category,
            task_class,
            status,
            location_lat,
            location_lng,
            geofence_radius_m,
            time_window_start,
            time_window_end,
            deadline_at,
            proof_policy_json,
            safety_flags_json
          )
          VALUES (
            $1,$2,$3,$4,$5,3,'NEW',$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb
          )
          RETURNING *
          `,
          [
            ticket.project_id,
            req.user!.id,
            escalatedTitle,
            ticket.description,
            ticket.category,
            ticket.location_lat,
            ticket.location_lng,
            ticket.geofence_radius_m,
            ticket.time_window_start,
            ticket.time_window_end,
            ticket.deadline_at,
            JSON.stringify({ source_ticket_id: ticket.id }),
            JSON.stringify(ticket.safety_flags_json ?? {})
          ]
        );

        await writeStatusEvent({
          ticketId: created.rows[0].id,
          actorUserId: req.user!.id,
          fromStatus: null,
          toStatus: "NEW",
          eventType: "ESCALATION_CREATED",
          payload: escalationPayload
        });
      }

      const updatedProof = await pool.query<DbProof>("SELECT * FROM proofs WHERE id = $1", [proof.id]);
      res.json(updatedProof.rows[0]);
    })
  );

  app.get(
    "/tickets/:ticketId/report.pdf",
    authorize("report:read"),
    asyncHandler(async (req, res) => {
      const ticket = await getTicketOrThrow(req.params.ticketId);
      const proofs = await listProofsByTicket(ticket.id);
      const events = await pool.query(
        "SELECT from_status, to_status, event_type, payload_json, created_at FROM status_events WHERE ticket_id = $1 ORDER BY created_at ASC",
        [ticket.id]
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=ticket-${ticket.id}.pdf`);

      const doc = new PDFDocument({ margin: 36, size: "A4" });
      doc.pipe(res);

      doc.fontSize(18).text("Umwelt-Compliance Ticket Report", { underline: true });
      doc.moveDown();

      doc.fontSize(12);
      doc.text(`Ticket ID: ${ticket.id}`);
      doc.text(`Title: ${ticket.title}`);
      doc.text(`Category: ${ticket.category}`);
      doc.text(`Class: ${ticket.task_class}`);
      doc.text(`Status: ${ticket.status}`);
      doc.text(`Deadline: ${ticket.deadline_at}`);
      doc.text(`Location: ${ticket.location_lat}, ${ticket.location_lng}`);
      doc.text(`Geofence (m): ${ticket.geofence_radius_m}`);
      doc.moveDown();

      doc.fontSize(14).text("Status History", { underline: true });
      doc.fontSize(10);
      for (const event of events.rows) {
        doc.text(`${event.created_at} | ${event.from_status ?? "-"} -> ${event.to_status} | ${event.event_type}`);
      }
      doc.moveDown();

      doc.fontSize(14).text("Proofs", { underline: true });
      doc.fontSize(10);
      if (proofs.length === 0) {
        doc.text("No proofs submitted.");
      } else {
        for (const proof of proofs) {
          doc.text(`Proof ${proof.id} | QA: ${proof.qa_status} | submitted: ${proof.submitted_at}`);
          doc.text(`Validation: ${JSON.stringify(proof.validation_flags_json)}`);
          doc.text(`Files: ${proof.files.map((f) => String(f.file_key)).join(", ")}`);
          doc.moveDown(0.5);
        }
      }

      doc.end();
    })
  );

  app.get(
    "/reports/project.pdf",
    authorize("report:read"),
    asyncHandler(async (req, res) => {
      const projectId = typeof req.query.project_id === "string" ? req.query.project_id : null;
      if (!projectId) {
        throw new Error("BAD_REQUEST:project_id query parameter is required");
      }

      const projectResult = await pool.query<DbProject>("SELECT * FROM projects WHERE id = $1", [projectId]);
      const project = projectResult.rows[0];
      if (!project) {
        throw new Error("NOT_FOUND:Project not found");
      }
      if (req.user!.role === "REQUESTER" && project.owner_user_id !== req.user!.id) {
        throw new Error("BAD_REQUEST:Project does not belong to requester");
      }

      const ticketsResult = await pool.query<DbTicket>(
        "SELECT * FROM tickets WHERE project_id = $1 ORDER BY created_at ASC",
        [projectId]
      );

      const ticketIds = ticketsResult.rows.map((ticket) => ticket.id);
      const proofCounts = new Map<string, number>();
      if (ticketIds.length > 0) {
        const proofCountsResult = await pool.query<{ ticket_id: string; proof_count: string }>(
          `
          SELECT ticket_id, COUNT(*)::text AS proof_count
          FROM proofs
          WHERE ticket_id = ANY($1::uuid[])
          GROUP BY ticket_id
          `,
          [ticketIds]
        );
        for (const row of proofCountsResult.rows) {
          proofCounts.set(row.ticket_id, Number(row.proof_count));
        }
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=project-${project.id}-report.pdf`);

      const doc = new PDFDocument({ margin: 36, size: "A4" });
      doc.pipe(res);

      doc.fontSize(18).text("Projekt Report", { underline: true });
      doc.moveDown();
      doc.fontSize(12);
      doc.text(`Project ID: ${project.id}`);
      doc.text(`Name: ${project.name}`);
      doc.text(`Description: ${project.description ?? "-"}`);
      doc.text(`Created At: ${project.created_at}`);
      doc.text(`Tickets: ${ticketsResult.rows.length}`);
      doc.moveDown();

      if (ticketsResult.rows.length === 0) {
        doc.text("Keine Tickets fuer dieses Projekt.");
      } else {
        doc.fontSize(14).text("Ticket Uebersicht", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10);

        for (const ticket of ticketsResult.rows) {
          doc.text(
            `${ticket.title} | Status: ${ticket.status} | Klasse: ${ticket.task_class} | Deadline: ${ticket.deadline_at} | Proofs: ${
              proofCounts.get(ticket.id) ?? 0
            }`
          );
          doc.moveDown(0.3);
        }
      }

      doc.end();
    })
  );
}
