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
import { hasPermission, type Permission } from "../lib/rbac";
import { ProofPolicy, QaDecision, QA_DECISIONS, Role, TicketStatus } from "../types";

const jpegExif: { fromBuffer: (buffer: Buffer) => Record<string, unknown> | undefined } = require("jpeg-exif");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const requiredDatetimeSchema = z.string().trim().min(1).refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "must be a valid datetime"
});

const optionalDatetimeSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "must be a valid datetime"
  })
  .nullable()
  .optional();

const ticketCreateSchema = z
  .object({
    project_id: z.string().uuid(),
    template_id: z.string().uuid().nullable().optional(),
    title: z.string().min(1),
    description: z.string().optional().default(""),
    category: z.string().min(1).optional(),
    task_class: z.number().int().min(1).max(3).optional(),
    location_lat: z.number().min(-90).max(90),
    location_lng: z.number().min(-180).max(180),
    geofence_radius_m: z.number().int().min(5).max(2000).optional(),
    time_window_start: optionalDatetimeSchema,
    time_window_end: optionalDatetimeSchema,
    deadline_at: requiredDatetimeSchema,
    proof_policy_json: z.record(z.any()).optional(),
    safety_flags_json: z.record(z.any()).optional().default({}),
    taxonomy_term_ids: z.array(z.string().uuid()).optional().default([]),
    origin: z.enum(["TOP_DOWN", "BOTTOM_UP_HINT"]).optional().default("TOP_DOWN"),
    hint_note: z.string().max(2000).optional().default("")
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

const workerHintSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().min(1).max(3000),
  category: z.string().min(1).max(150),
  location_lat: z.coerce.number().min(-90).max(90),
  location_lng: z.coerce.number().min(-180).max(180),
  geofence_radius_m: z.coerce.number().int().min(5).max(2000).optional().default(25),
  deadline_at: optionalDatetimeSchema,
  observed_at: optionalDatetimeSchema,
  taxonomy_term_ids_json: z.string().optional().default("[]")
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

const adminUserCreateSchema = z.object({
  email: z.string().trim().email(),
  display_name: z.string().trim().max(120).optional().default(""),
  role: z.enum(["ADMIN", "REQUESTER", "WORKER", "QA"]),
  is_verified: z.boolean().optional().default(true)
});

const qualifySchema = z.object({
  task_class: z.number().int().min(1).max(3).optional(),
  proof_policy_json: z.record(z.any()).optional()
});

const qaDecisionSchema = z.object({
  decision: z.enum(QA_DECISIONS),
  comment: z.string().optional().default("")
});

const kanbanMoveSchema = z.object({
  to_status: z.enum([
    "QUALIFIED",
    "PUBLISHED",
    "ACCEPTED",
    "PROOF_SUBMITTED",
    "NEEDS_CHANGES",
    "COMPLETED",
    "REJECTED",
    "ARCHIVED"
  ])
});

const taxonomyCreateSchema = z.object({
  domain: z.string().min(1).max(100),
  label: z.string().min(1).max(120),
  slug: z.string().min(1).max(160).regex(/^[a-z0-9-]+$/),
  active: z.boolean().optional().default(true),
  order_index: z.number().int().min(0).optional().default(0)
});

const taxonomyPatchSchema = z.object({
  domain: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(160).regex(/^[a-z0-9-]+$/).optional(),
  active: z.boolean().optional(),
  order_index: z.number().int().min(0).optional()
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

type DbTicket = {
  id: string;
  project_id: string;
  creator_user_id: string;
  title: string;
  description: string | null;
  category: string;
  task_class: number;
  origin: "TOP_DOWN" | "BOTTOM_UP_HINT";
  hint_note: string | null;
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

type DbTicketWithTaxonomy = DbTicket & {
  taxonomy_terms: DbTaxonomyTerm[];
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

type DbTaxonomyTerm = {
  id: string;
  domain: string;
  label: string;
  slug: string;
  active: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type DbPushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
};

type DbNotificationEvent = {
  id: string;
  user_id: string;
  ticket_id: string | null;
  event_type: string;
  title: string;
  body: string;
  payload_json: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
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

function parseJsonStringArray(input: string, fieldName: string): string[] {
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("invalid");
    }
    return parsed as string[];
  } catch (_error) {
    throw new Error(`BAD_REQUEST:${fieldName} must be a JSON string array`);
  }
}

function normalizeToIsoString(value: string, fieldName: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`BAD_REQUEST:${fieldName} must be a valid datetime`);
  }
  return parsed.toISOString();
}

function toCsvCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const result = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
  if (!result.rows[0]) {
    throw new Error("BAD_REQUEST:project_id does not exist");
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

async function assertActiveTaxonomyTerms(termIds: string[]): Promise<void> {
  if (termIds.length === 0) {
    return;
  }

  const result = await pool.query<{ id: string }>(
    "SELECT id FROM taxonomy_terms WHERE active = true AND id = ANY($1::uuid[])",
    [termIds]
  );

  if (result.rows.length !== termIds.length) {
    throw new Error("BAD_REQUEST:One or more taxonomy terms are invalid or inactive");
  }
}

async function replaceTicketTaxonomy(ticketId: string, termIds: string[]): Promise<void> {
  await pool.query("DELETE FROM ticket_taxonomy WHERE ticket_id = $1", [ticketId]);

  if (termIds.length === 0) {
    return;
  }

  await pool.query(
    `
    INSERT INTO ticket_taxonomy (ticket_id, term_id)
    SELECT $1, term_id
    FROM UNNEST($2::uuid[]) AS term_id
    `,
    [ticketId, termIds]
  );
}

async function hydrateTicketTaxonomy(rows: DbTicket[]): Promise<DbTicketWithTaxonomy[]> {
  if (rows.length === 0) {
    return [];
  }

  const ticketIds = rows.map((row) => row.id);
  const termsResult = await pool.query<DbTaxonomyTerm & { ticket_id: string }>(
    `
    SELECT
      tt.ticket_id,
      t.id,
      t.domain,
      t.label,
      t.slug,
      t.active,
      t.order_index,
      t.created_at,
      t.updated_at
    FROM ticket_taxonomy tt
    JOIN taxonomy_terms t ON t.id = tt.term_id
    WHERE tt.ticket_id = ANY($1::uuid[])
    ORDER BY t.domain ASC, t.order_index ASC, t.label ASC
    `,
    [ticketIds]
  );

  const bucket = new Map<string, DbTaxonomyTerm[]>();
  for (const term of termsResult.rows) {
    const entry: DbTaxonomyTerm = {
      id: term.id,
      domain: term.domain,
      label: term.label,
      slug: term.slug,
      active: term.active,
      order_index: term.order_index,
      created_at: term.created_at,
      updated_at: term.updated_at
    };
    const existing = bucket.get(term.ticket_id);
    if (existing) {
      existing.push(entry);
    } else {
      bucket.set(term.ticket_id, [entry]);
    }
  }

  return rows.map((row) => ({
    ...row,
    taxonomy_terms: bucket.get(row.id) ?? []
  }));
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

async function queueClassThreeNotifications(params: {
  ticket: DbTicket;
  actorUserId: string;
  eventType: string;
  body: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (params.ticket.task_class !== 3) {
    return;
  }

  const recipientsResult = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE role = ANY($1::text[])",
    [["QA", "REQUESTER"]]
  );

  for (const recipient of recipientsResult.rows) {
    if (recipient.id === params.actorUserId) {
      continue;
    }

    await pool.query(
      `
      INSERT INTO notification_events (user_id, ticket_id, event_type, title, body, payload_json)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)
      `,
      [
        recipient.id,
        params.ticket.id,
        params.eventType,
        `Klasse-3 Ticket: ${params.ticket.title}`,
        params.body,
        JSON.stringify(params.payload ?? {})
      ]
    );
  }
}

function getKanbanPermissionForTargetStatus(toStatus: TicketStatus): Permission | null {
  switch (toStatus) {
    case "QUALIFIED":
      return "ticket:qualify";
    case "PUBLISHED":
      return "ticket:publish";
    case "ACCEPTED":
      return "ticket:accept";
    case "PROOF_SUBMITTED":
      return "proof:submit";
    case "NEEDS_CHANGES":
    case "COMPLETED":
    case "REJECTED":
      return "proof:qa";
    case "ARCHIVED":
      return "ticket:publish";
    default:
      return null;
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

  const updatedTicket = await getTicketOrThrow(params.ticketId);
  await queueClassThreeNotifications({
    ticket: updatedTicket,
    actorUserId: params.actorUserId,
    eventType: params.eventType ?? "STATUS_CHANGE",
    body: `Statuswechsel ${params.fromStatus} -> ${params.toStatus}`,
    payload: {
      from_status: params.fromStatus,
      to_status: params.toStatus,
      ...(params.payload ?? {})
    }
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

  app.post(
    "/admin/users",
    authorize("admin:users:write"),
    asyncHandler(async (req, res) => {
      const payload = adminUserCreateSchema.parse(req.body);
      const normalizedEmail = payload.email.toLowerCase();
      const normalizedDisplayName = payload.display_name.trim();

      const existingUser = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
        [normalizedEmail]
      );
      if (existingUser.rows[0]) {
        throw new Error("BAD_REQUEST:Email already exists");
      }

      const created = await pool.query(
        `
        INSERT INTO users (email, display_name, role, is_verified)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, display_name, role, is_verified, created_at
        `,
        [normalizedEmail, normalizedDisplayName.length > 0 ? normalizedDisplayName : null, payload.role, payload.is_verified]
      );

      res.status(201).json(created.rows[0]);
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

  app.post(
    "/push/subscriptions",
    authorize("notification:subscribe"),
    asyncHandler(async (req, res) => {
      const payload = pushSubscriptionSchema.parse(req.body);
      const result = await pool.query<DbPushSubscription>(
        `
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (user_id, endpoint) DO UPDATE
        SET p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent
        RETURNING *
        `,
        [req.user!.id, payload.endpoint, payload.keys.p256dh, payload.keys.auth, req.get("User-Agent") ?? null]
      );
      res.status(201).json(result.rows[0]);
    })
  );

  app.get(
    "/push/subscriptions",
    authorize("notification:subscribe"),
    asyncHandler(async (req, res) => {
      const result = await pool.query<DbPushSubscription>(
        "SELECT * FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC",
        [req.user!.id]
      );
      res.json(result.rows);
    })
  );

  app.delete(
    "/push/subscriptions/:subscriptionId",
    authorize("notification:subscribe"),
    asyncHandler(async (req, res) => {
      const deleted = await pool.query<{ id: string }>(
        "DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id",
        [req.params.subscriptionId, req.user!.id]
      );
      if (!deleted.rows[0]) {
        throw new Error("NOT_FOUND:Push subscription not found");
      }
      res.status(204).send();
    })
  );

  app.get(
    "/notifications",
    authorize("notification:read"),
    asyncHandler(async (req, res) => {
      const unreadOnly = req.query.unread_only !== "false";
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 30;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 30;

      const whereParts = ["user_id = $1"];
      const params: unknown[] = [req.user!.id];
      if (unreadOnly) {
        whereParts.push("is_read = false");
      }
      params.push(limit);

      const result = await pool.query<DbNotificationEvent>(
        `
        SELECT *
        FROM notification_events
        WHERE ${whereParts.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $2
        `,
        params
      );

      res.json(result.rows);
    })
  );

  app.post(
    "/notifications/:notificationId/read",
    authorize("notification:read"),
    asyncHandler(async (req, res) => {
      const result = await pool.query<DbNotificationEvent>(
        `
        UPDATE notification_events
        SET is_read = true,
            read_at = now()
        WHERE id = $1
          AND user_id = $2
        RETURNING *
        `,
        [req.params.notificationId, req.user!.id]
      );

      if (!result.rows[0]) {
        throw new Error("NOT_FOUND:Notification not found");
      }

      res.json(result.rows[0]);
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
    "/taxonomy/terms",
    authorize("taxonomy:read"),
    asyncHandler(async (req, res) => {
      const domainFilter = typeof req.query.domain === "string" ? req.query.domain : null;
      const qFilter = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : null;
      const includeInactive = req.query.include_inactive === "true";

      const where: string[] = [];
      const params: unknown[] = [];

      if (domainFilter) {
        params.push(domainFilter);
        where.push(`domain = $${params.length}`);
      }

      if (!includeInactive) {
        where.push("active = true");
      }

      if (qFilter) {
        params.push(`%${qFilter}%`);
        where.push(`LOWER(label) LIKE $${params.length}`);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const result = await pool.query<DbTaxonomyTerm>(
        `SELECT * FROM taxonomy_terms ${whereClause} ORDER BY domain ASC, order_index ASC, label ASC`,
        params
      );
      res.json(result.rows);
    })
  );

  app.post(
    "/taxonomy/terms",
    authorize("taxonomy:write"),
    asyncHandler(async (req, res) => {
      const payload = taxonomyCreateSchema.parse(req.body);
      const result = await pool.query<DbTaxonomyTerm>(
        `
        INSERT INTO taxonomy_terms (domain, label, slug, active, order_index)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [payload.domain, payload.label, payload.slug, payload.active, payload.order_index]
      );
      res.status(201).json(result.rows[0]);
    })
  );

  app.patch(
    "/taxonomy/terms/:termId",
    authorize("taxonomy:write"),
    asyncHandler(async (req, res) => {
      const payload = taxonomyPatchSchema.parse(req.body ?? {});
      const hasAnyField =
        payload.domain !== undefined ||
        payload.label !== undefined ||
        payload.slug !== undefined ||
        payload.active !== undefined ||
        payload.order_index !== undefined;
      if (!hasAnyField) {
        throw new Error("BAD_REQUEST:No taxonomy fields provided");
      }

      const result = await pool.query<DbTaxonomyTerm>(
        `
        UPDATE taxonomy_terms
        SET
          domain = COALESCE($1, domain),
          label = COALESCE($2, label),
          slug = COALESCE($3, slug),
          active = COALESCE($4, active),
          order_index = COALESCE($5, order_index)
        WHERE id = $6
        RETURNING *
        `,
        [
          payload.domain ?? null,
          payload.label ?? null,
          payload.slug ?? null,
          payload.active ?? null,
          payload.order_index ?? null,
          req.params.termId
        ]
      );

      if (!result.rows[0]) {
        throw new Error("NOT_FOUND:Taxonomy term not found");
      }

      res.json(result.rows[0]);
    })
  );

  app.get(
    "/tickets",
    authorize("ticket:list"),
    asyncHandler(async (req, res) => {
      const statusFilter = typeof req.query.status === "string" ? req.query.status : null;
      const projectFilter = typeof req.query.project_id === "string" ? req.query.project_id : null;
      const taxonomyTermIdsRaw = typeof req.query.taxonomy_term_ids === "string" ? req.query.taxonomy_term_ids : null;
      const taxonomyQuery = typeof req.query.taxonomy_query === "string" ? req.query.taxonomy_query.trim() : null;
      const dateFromRaw = typeof req.query.date_from === "string" ? req.query.date_from : null;
      const dateToRaw = typeof req.query.date_to === "string" ? req.query.date_to : null;
      const nearLat = typeof req.query.near_lat === "string" ? Number(req.query.near_lat) : null;
      const nearLng = typeof req.query.near_lng === "string" ? Number(req.query.near_lng) : null;
      const nearRadiusKm =
        typeof req.query.near_radius_km === "string" ? Number(req.query.near_radius_km) : 10;

      const params: unknown[] = [];
      const whereParts: string[] = [];

      const taxonomyTermIds =
        taxonomyTermIdsRaw == null || taxonomyTermIdsRaw.trim() === ""
          ? []
          : taxonomyTermIdsRaw
              .split(",")
              .map((value) => value.trim())
              .filter((value) => value.length > 0);

      if (statusFilter) {
        params.push(statusFilter);
        whereParts.push(`t.status = $${params.length}`);
      }

      if (projectFilter) {
        params.push(projectFilter);
        whereParts.push(`t.project_id = $${params.length}`);
      }

      if (taxonomyTermIds.length > 0) {
        params.push(taxonomyTermIds);
        whereParts.push(`t.id IN (SELECT ticket_id FROM ticket_taxonomy WHERE term_id = ANY($${params.length}::uuid[]))`);
      }

      if (taxonomyQuery) {
        params.push(`%${taxonomyQuery.toLowerCase()}%`);
        whereParts.push(`t.id IN (
          SELECT tt.ticket_id
          FROM ticket_taxonomy tt
          JOIN taxonomy_terms tx ON tx.id = tt.term_id
          WHERE LOWER(tx.label) LIKE $${params.length}
        )`);
      }

      if (dateFromRaw) {
        const parsed = new Date(dateFromRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("BAD_REQUEST:date_from must be a valid date");
        }
        params.push(parsed.toISOString());
        whereParts.push(`t.created_at >= $${params.length}`);
      }

      if (dateToRaw) {
        const parsed = new Date(dateToRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("BAD_REQUEST:date_to must be a valid date");
        }
        params.push(parsed.toISOString());
        whereParts.push(`t.created_at <= $${params.length}`);
      }

      if (req.user?.role === "WORKER" && !statusFilter) {
        params.push(req.user.id);
        whereParts.push(
          `(t.status = 'PUBLISHED' OR (t.status IN ('ACCEPTED', 'NEEDS_CHANGES') AND t.accepted_by_user_id = $${params.length}))`
        );
      }

      const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const result = await pool.query<DbTicket>(
        `SELECT t.* FROM tickets t ${whereClause} ORDER BY t.created_at DESC`,
        params
      );

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

      const hydrated = await hydrateTicketTaxonomy(rows);
      res.json(hydrated);
    })
  );

  app.post(
    "/tickets",
    authorize("ticket:create"),
    asyncHandler(async (req, res) => {
      const payload = ticketCreateSchema.parse(req.body);
      const template = payload.template_id ? await getTemplateOrThrow(payload.template_id) : null;
      await assertProjectExists(payload.project_id);

      const category = payload.category ?? template?.category;
      const taskClass = payload.task_class ?? template?.task_class;
      const geofenceRadiusM = payload.geofence_radius_m ?? template?.default_geofence_radius_m;
      const proofPolicy = payload.proof_policy_json ?? template?.proof_policy_json ?? {};
      const normalizedDeadlineAt = normalizeToIsoString(payload.deadline_at, "deadline_at");
      const normalizedWindowStart = payload.time_window_start
        ? normalizeToIsoString(payload.time_window_start, "time_window_start")
        : null;
      const normalizedWindowEnd = payload.time_window_end
        ? normalizeToIsoString(payload.time_window_end, "time_window_end")
        : null;
      const taxonomyTermIds = Array.from(new Set(payload.taxonomy_term_ids));

      if (!category) {
        throw new Error("BAD_REQUEST:category is required");
      }
      if (!taskClass) {
        throw new Error("BAD_REQUEST:task_class is required");
      }
      if (!geofenceRadiusM) {
        throw new Error("BAD_REQUEST:geofence_radius_m is required");
      }

      await assertActiveTaxonomyTerms(taxonomyTermIds);

      const insertResult = await pool.query<DbTicket>(
        `
        INSERT INTO tickets (
          project_id,
          creator_user_id,
          title,
          description,
          category,
          task_class,
          origin,
          hint_note,
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
          $1,$2,$3,$4,$5,$6,$7,$8,'NEW',$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb
        )
        RETURNING *
        `,
        [
          payload.project_id,
          req.user!.id,
          payload.title,
          payload.description,
          category,
          taskClass,
          payload.origin,
          payload.hint_note || null,
          payload.location_lat,
          payload.location_lng,
          geofenceRadiusM,
          normalizedWindowStart,
          normalizedWindowEnd,
          normalizedDeadlineAt,
          JSON.stringify(proofPolicy),
          JSON.stringify(payload.safety_flags_json)
        ]
      );

      const ticket = insertResult.rows[0];
      await replaceTicketTaxonomy(ticket.id, taxonomyTermIds);
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

      await queueClassThreeNotifications({
        ticket,
        actorUserId: req.user!.id,
        eventType: "TICKET_CREATED",
        body: "Neues Klasse-3 Ticket angelegt",
        payload: {
          ticket_id: ticket.id,
          origin: ticket.origin
        }
      });

      const hydrated = await hydrateTicketTaxonomy([ticket]);
      res.status(201).json(hydrated[0]);
    })
  );

  app.post(
    "/tickets/hints",
    authorize("ticket:hint:create"),
    upload.array("files", 6),
    asyncHandler(async (req, res) => {
      const payload = workerHintSchema.parse(req.body);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (files.length < 1) {
        throw new Error("BAD_REQUEST:At least one photo is required for a hint ticket");
      }

      await assertProjectExists(payload.project_id);
      const taxonomyTermIds = Array.from(
        new Set(parseJsonStringArray(payload.taxonomy_term_ids_json, "taxonomy_term_ids_json"))
      );
      await assertActiveTaxonomyTerms(taxonomyTermIds);

      const observedAt = payload.observed_at
        ? normalizeToIsoString(payload.observed_at, "observed_at")
        : new Date().toISOString();
      const deadlineAt = payload.deadline_at
        ? normalizeToIsoString(payload.deadline_at, "deadline_at")
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const proofPolicy = {
        min_photos: 1,
        require_gps: true,
        required_fields: ["misstand_beschreibung", "standort_verifiziert", "foto_vorhanden"]
      };

      const ticketResult = await pool.query<DbTicket>(
        `
        INSERT INTO tickets (
          project_id,
          creator_user_id,
          title,
          description,
          category,
          task_class,
          origin,
          hint_note,
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
        VALUES ($1,$2,$3,$4,$5,2,'BOTTOM_UP_HINT',$6,'NEW',$7,$8,$9,NULL,NULL,$10,$11::jsonb,$12::jsonb)
        RETURNING *
        `,
        [
          payload.project_id,
          req.user!.id,
          payload.title,
          payload.description,
          payload.category,
          payload.description,
          payload.location_lat,
          payload.location_lng,
          payload.geofence_radius_m,
          deadlineAt,
          JSON.stringify(proofPolicy),
          JSON.stringify({ hint_observed_at: observedAt })
        ]
      );

      const ticket = ticketResult.rows[0];
      await replaceTicketTaxonomy(ticket.id, taxonomyTermIds);
      await writeStatusEvent({
        ticketId: ticket.id,
        actorUserId: req.user!.id,
        fromStatus: null,
        toStatus: "NEW",
        eventType: "HINT_TICKET_CREATED",
        payload: {
          reason: "worker_bottom_up_hint",
          observed_at: observedAt
        }
      });

      let exifPresent = false;
      let capturedAt: string | null = observedAt;

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
          payload.location_lat,
          payload.location_lng,
          capturedAt,
          JSON.stringify({ geofence_ok: true, time_ok: true, exif_present: false }),
          JSON.stringify({
            misstand_beschreibung: payload.description,
            standort_verifiziert: true,
            foto_vorhanden: true
          }),
          payload.description
        ]
      );

      const proof = proofResult.rows[0];
      for (const file of files) {
        const fileBuffer = fs.readFileSync(file.path);
        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        const exifMeta = extractExifMetadata(fileBuffer);

        if (!exifPresent && exifMeta.hasExif) {
          exifPresent = true;
        }
        if (capturedAt == null && exifMeta.capturedAt != null) {
          capturedAt = exifMeta.capturedAt.toISOString();
        }

        await pool.query(
          `
          INSERT INTO proof_files (proof_id, file_key, file_mime, file_size, sha256)
          VALUES ($1,$2,$3,$4,$5)
          `,
          [proof.id, path.basename(file.path), file.mimetype, file.size, sha256]
        );
      }

      await pool.query(
        `
        UPDATE proofs
        SET captured_at = $1,
            validation_flags_json = $2::jsonb
        WHERE id = $3
        `,
        [capturedAt, JSON.stringify({ geofence_ok: true, time_ok: true, exif_present: exifPresent }), proof.id]
      );

      await writeStatusEvent({
        ticketId: ticket.id,
        actorUserId: req.user!.id,
        fromStatus: ticket.status,
        toStatus: ticket.status,
        eventType: "HINT_PROOF_ATTACHED",
        payload: {
          proof_id: proof.id,
          file_count: files.length
        }
      });

      const recipients = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE role = ANY($1::text[])",
        [["QA", "REQUESTER"]]
      );
      for (const recipient of recipients.rows) {
        await pool.query(
          `
          INSERT INTO notification_events (user_id, ticket_id, event_type, title, body, payload_json)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb)
          `,
          [
            recipient.id,
            ticket.id,
            "WORKER_HINT_CREATED",
            `Neuer Hinweis: ${ticket.title}`,
            "Ein Mitarbeiter hat einen Misstand gemeldet und ein Ticket eroefnet.",
            JSON.stringify({ ticket_id: ticket.id, origin: ticket.origin })
          ]
        );
      }

      const hydrated = await hydrateTicketTaxonomy([ticket]);
      res.status(201).json({
        ...hydrated[0],
        initial_proof_id: proof.id
      });
    })
  );

  app.get(
    "/tickets/:ticketId",
    authorize("ticket:detail"),
    asyncHandler(async (req, res) => {
      const ticket = await getTicketOrThrow(req.params.ticketId);
      const proofs = await listProofsByTicket(ticket.id);
      const hydrated = await hydrateTicketTaxonomy([ticket]);
      const eventsResult = await pool.query(
        "SELECT * FROM status_events WHERE ticket_id = $1 ORDER BY created_at ASC",
        [ticket.id]
      );

      res.json({ ...hydrated[0], proofs, status_events: eventsResult.rows });
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
    "/tickets/:ticketId/move",
    authorize("ticket:move"),
    asyncHandler(async (req, res) => {
      const payload = kanbanMoveSchema.parse(req.body);
      const ticket = await getTicketOrThrow(req.params.ticketId);
      const requiredPermission = getKanbanPermissionForTargetStatus(payload.to_status);

      if (!requiredPermission || !hasPermission(req.user!.role, requiredPermission)) {
        throw new Error(`BAD_REQUEST:Role ${req.user!.role} cannot move ticket to ${payload.to_status}`);
      }
      if (payload.to_status === "ARCHIVED" && req.user!.role !== "ADMIN") {
        throw new Error("BAD_REQUEST:Only ADMIN may archive tickets via kanban");
      }

      if (payload.to_status === "ACCEPTED") {
        if (req.user!.role === "WORKER") {
          const activeResult = await pool.query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM tickets WHERE status = 'ACCEPTED' AND accepted_by_user_id = $1",
            [req.user!.id]
          );
          if (Number(activeResult.rows[0].count) > 0) {
            throw new Error("BAD_REQUEST:Worker already has an active accepted ticket");
          }
        }

        assertTransition(ticket.status, "ACCEPTED");
        const update = await pool.query<DbTicket>(
          `
          UPDATE tickets
          SET status = 'ACCEPTED',
              accepted_by_user_id = $1,
              accepted_at = COALESCE(accepted_at, now())
          WHERE id = $2
            AND status = $3
          RETURNING *
          `,
          [req.user!.id, ticket.id, ticket.status]
        );

        const updated = update.rows[0];
        if (!updated) {
          throw new Error("BAD_REQUEST:Ticket status changed concurrently");
        }

        await writeStatusEvent({
          ticketId: updated.id,
          actorUserId: req.user!.id,
          fromStatus: ticket.status,
          toStatus: "ACCEPTED",
          eventType: "KANBAN_MOVE",
          payload: {
            target_status: "ACCEPTED"
          }
        });

        await queueClassThreeNotifications({
          ticket: updated,
          actorUserId: req.user!.id,
          eventType: "KANBAN_MOVE",
          body: `Statuswechsel ${ticket.status} -> ACCEPTED`,
          payload: {
            from_status: ticket.status,
            to_status: "ACCEPTED"
          }
        });

        const hydrated = await hydrateTicketTaxonomy([updated]);
        res.json(hydrated[0]);
        return;
      }

      await transitionTicketStatus({
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: payload.to_status,
        actorUserId: req.user!.id,
        eventType: "KANBAN_MOVE",
        payload: {
          from_status: ticket.status,
          to_status: payload.to_status
        }
      });

      const updated = await getTicketOrThrow(ticket.id);
      const hydrated = await hydrateTicketTaxonomy([updated]);
      res.json(hydrated[0]);
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

        await queueClassThreeNotifications({
          ticket: created.rows[0],
          actorUserId: req.user!.id,
          eventType: "ESCALATION_CREATED",
          body: "Neues Klasse-3 Eskalationsticket wurde erstellt",
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
    "/exports/ka5.json",
    authorize("export:ka5:read"),
    asyncHandler(async (req, res) => {
      const projectFilter = typeof req.query.project_id === "string" ? req.query.project_id : null;
      const dateFromRaw = typeof req.query.date_from === "string" ? req.query.date_from : null;
      const dateToRaw = typeof req.query.date_to === "string" ? req.query.date_to : null;
      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (projectFilter) {
        params.push(projectFilter);
        whereParts.push(`t.project_id = $${params.length}`);
      }

      if (req.user!.role === "REQUESTER") {
        params.push(req.user!.id);
        whereParts.push(`p.owner_user_id = $${params.length}`);
      }

      if (dateFromRaw) {
        const parsed = new Date(dateFromRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("BAD_REQUEST:date_from must be a valid date");
        }
        params.push(parsed.toISOString());
        whereParts.push(`t.created_at >= $${params.length}`);
      }

      if (dateToRaw) {
        const parsed = new Date(dateToRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("BAD_REQUEST:date_to must be a valid date");
        }
        params.push(parsed.toISOString());
        whereParts.push(`t.created_at <= $${params.length}`);
      }

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      const rows = await pool.query<
        DbTicket & {
          project_name: string;
          proof_count: string;
          taxonomy_labels: string | null;
        }
      >(
        `
        WITH proof_counts AS (
          SELECT ticket_id, COUNT(*)::text AS proof_count
          FROM proofs
          GROUP BY ticket_id
        ),
        taxonomy_agg AS (
          SELECT
            tt.ticket_id,
            string_agg(tx.label, ', ' ORDER BY tx.domain, tx.order_index, tx.label) AS taxonomy_labels
          FROM ticket_taxonomy tt
          JOIN taxonomy_terms tx ON tx.id = tt.term_id
          GROUP BY tt.ticket_id
        )
        SELECT
          t.*,
          p.name AS project_name,
          COALESCE(pc.proof_count, '0') AS proof_count,
          COALESCE(ta.taxonomy_labels, '') AS taxonomy_labels
        FROM tickets t
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN proof_counts pc ON pc.ticket_id = t.id
        LEFT JOIN taxonomy_agg ta ON ta.ticket_id = t.id
        ${whereClause}
        ORDER BY t.created_at DESC
        `,
        params
      );

      res.json({
        profile: "KA5_MVP_v1",
        generated_at: new Date().toISOString(),
        filters: {
          project_id: projectFilter,
          date_from: dateFromRaw,
          date_to: dateToRaw
        },
        rows: rows.rows.map((row) => ({
          project_id: row.project_id,
          project_name: row.project_name,
          ticket_id: row.id,
          title: row.title,
          category: row.category,
          taxonomy_labels: row.taxonomy_labels ?? "",
          task_class: row.task_class,
          status: row.status,
          origin: row.origin,
          hint_note: row.hint_note ?? "",
          location_lat: row.location_lat,
          location_lng: row.location_lng,
          geofence_radius_m: row.geofence_radius_m,
          time_window_start: row.time_window_start,
          time_window_end: row.time_window_end,
          deadline_at: row.deadline_at,
          created_at: row.created_at,
          proof_count: Number(row.proof_count)
        }))
      });
    })
  );

  app.get(
    "/exports/ka5.csv",
    authorize("export:ka5:read"),
    asyncHandler(async (req, res) => {
      const projectFilter = typeof req.query.project_id === "string" ? req.query.project_id : null;
      const dateFromRaw = typeof req.query.date_from === "string" ? req.query.date_from : null;
      const dateToRaw = typeof req.query.date_to === "string" ? req.query.date_to : null;
      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (projectFilter) {
        params.push(projectFilter);
        whereParts.push(`t.project_id = $${params.length}`);
      }

      if (req.user!.role === "REQUESTER") {
        params.push(req.user!.id);
        whereParts.push(`p.owner_user_id = $${params.length}`);
      }

      if (dateFromRaw) {
        const parsed = new Date(dateFromRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("BAD_REQUEST:date_from must be a valid date");
        }
        params.push(parsed.toISOString());
        whereParts.push(`t.created_at >= $${params.length}`);
      }

      if (dateToRaw) {
        const parsed = new Date(dateToRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("BAD_REQUEST:date_to must be a valid date");
        }
        params.push(parsed.toISOString());
        whereParts.push(`t.created_at <= $${params.length}`);
      }

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      const rows = await pool.query<
        DbTicket & {
          project_name: string;
          proof_count: string;
          taxonomy_labels: string | null;
        }
      >(
        `
        WITH proof_counts AS (
          SELECT ticket_id, COUNT(*)::text AS proof_count
          FROM proofs
          GROUP BY ticket_id
        ),
        taxonomy_agg AS (
          SELECT
            tt.ticket_id,
            string_agg(tx.label, ', ' ORDER BY tx.domain, tx.order_index, tx.label) AS taxonomy_labels
          FROM ticket_taxonomy tt
          JOIN taxonomy_terms tx ON tx.id = tt.term_id
          GROUP BY tt.ticket_id
        )
        SELECT
          t.*,
          p.name AS project_name,
          COALESCE(pc.proof_count, '0') AS proof_count,
          COALESCE(ta.taxonomy_labels, '') AS taxonomy_labels
        FROM tickets t
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN proof_counts pc ON pc.ticket_id = t.id
        LEFT JOIN taxonomy_agg ta ON ta.ticket_id = t.id
        ${whereClause}
        ORDER BY t.created_at DESC
        `,
        params
      );

      const header = [
        "project_id",
        "project_name",
        "ticket_id",
        "title",
        "category",
        "taxonomy_labels",
        "task_class",
        "status",
        "origin",
        "hint_note",
        "location_lat",
        "location_lng",
        "geofence_radius_m",
        "time_window_start",
        "time_window_end",
        "deadline_at",
        "created_at",
        "proof_count"
      ];

      const lines = [header.join(",")];
      for (const row of rows.rows) {
        lines.push(
          [
            row.project_id,
            row.project_name,
            row.id,
            row.title,
            row.category,
            row.taxonomy_labels ?? "",
            row.task_class,
            row.status,
            row.origin,
            row.hint_note ?? "",
            row.location_lat,
            row.location_lng,
            row.geofence_radius_m,
            row.time_window_start ?? "",
            row.time_window_end ?? "",
            row.deadline_at,
            row.created_at,
            row.proof_count
          ]
            .map((value) => toCsvCell(value))
            .join(",")
        );
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=ka5-export.csv");
      res.send(lines.join("\n"));
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
