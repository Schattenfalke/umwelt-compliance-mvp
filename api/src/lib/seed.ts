import { pool } from "./db";

const demoUsers = [
  { email: "admin@example.com", displayName: "Admin", role: "ADMIN" },
  { email: "requester@example.com", displayName: "Requester", role: "REQUESTER" },
  { email: "worker@example.com", displayName: "Worker", role: "WORKER" },
  { email: "qa@example.com", displayName: "QA", role: "QA" }
] as const;

const demoTemplates = [
  {
    name: "Vegetationskontrolle (Bodenschutz)",
    category: "Vegetationskontrolle - Bodenschutz",
    taskClass: 1,
    checklist: {
      fields: [
        {
          key: "wuchs_status",
          type: "enum",
          required: true,
          options: ["OK", "ZU_NIEDRIG", "NICHT_VORHANDEN"]
        },
        { key: "kommentar", type: "text", required: false }
      ]
    },
    proofPolicy: {
      min_photos: 2,
      require_gps: true,
      redundancy: 2,
      required_fields: ["wuchs_status"]
    },
    geofenceRadiusM: 25
  },
  {
    name: "Werkzeugreinigung nach SOP",
    category: "Werkzeugreinigung SOP",
    taskClass: 2,
    checklist: {
      fields: [
        { key: "werkzeug_id", type: "string", required: true },
        { key: "reinigungsschritte", type: "array_bool", required: true },
        { key: "schutzkleidung_getragen", type: "boolean", required: true },
        { key: "rueckgabe_bestaetigt", type: "boolean", required: true }
      ]
    },
    proofPolicy: {
      min_photos: 4,
      require_gps: true,
      redundancy: 0,
      required_fields: ["werkzeug_id", "reinigungsschritte", "schutzkleidung_getragen", "rueckgabe_bestaetigt"]
    },
    geofenceRadiusM: 50
  },
  {
    name: "Probenentnahme nach Anleitung",
    category: "Probenentnahme SOP",
    taskClass: 3,
    checklist: {
      fields: [{ key: "hinweis", type: "text", required: true }]
    },
    proofPolicy: {
      min_photos: 2,
      require_gps: true,
      required_fields: ["hinweis"]
    },
    geofenceRadiusM: 25
  }
] as const;

export async function ensureDemoUsers(): Promise<void> {
  for (const user of demoUsers) {
    await pool.query(
      `
      INSERT INTO users (email, display_name, role, is_verified)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (email) DO NOTHING
      `,
      [user.email, user.displayName, user.role]
    );
  }
}

export async function ensureDemoTemplates(): Promise<void> {
  for (const template of demoTemplates) {
    await pool.query(
      `
      INSERT INTO ticket_templates (
        name,
        category,
        task_class,
        checklist_json,
        proof_policy_json,
        default_geofence_radius_m
      )
      SELECT $1, $2, $3, $4::jsonb, $5::jsonb, $6
      WHERE NOT EXISTS (SELECT 1 FROM ticket_templates WHERE name = $1)
      `,
      [
        template.name,
        template.category,
        template.taskClass,
        JSON.stringify(template.checklist),
        JSON.stringify(template.proofPolicy),
        template.geofenceRadiusM
      ]
    );
  }
}
