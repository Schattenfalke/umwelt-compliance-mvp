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
    name: "Probenentnahme mit Bohrstock",
    category: "Probenentnahme - Bohrstock",
    taskClass: 3,
    checklist: {
      fields: [
        { key: "bohrstock_typ", type: "enum", required: true, options: ["Puerckhauer", "Edelman", "Andere"] },
        { key: "bohrtiefe_cm", type: "number", required: true },
        { key: "horizont_code", type: "string", required: true },
        { key: "bodenfeuchte", type: "enum", required: true, options: ["trocken", "frisch", "feucht", "nass"] },
        { key: "probe_entnommen", type: "boolean", required: true },
        { key: "kommentar", type: "text", required: false }
      ]
    },
    proofPolicy: {
      min_photos: 3,
      require_gps: true,
      redundancy: 1,
      required_fields: ["bohrstock_typ", "bohrtiefe_cm", "horizont_code", "bodenfeuchte", "probe_entnommen"]
    },
    geofenceRadiusM: 25
  }
] as const;

const demoTaxonomyTerms = [
  { domain: "vegetation", label: "Luzerne", slug: "vegetation-luzerne", orderIndex: 10 },
  { domain: "vegetation", label: "Grasland", slug: "vegetation-grasland", orderIndex: 20 },
  { domain: "incident_type", label: "Vandalismus", slug: "incident-vandalismus", orderIndex: 30 },
  { domain: "incident_type", label: "Verschmutzung", slug: "incident-verschmutzung", orderIndex: 40 },
  { domain: "waste_type", label: "Reifen", slug: "waste-reifen", orderIndex: 50 },
  { domain: "waste_type", label: "Bauschutt", slug: "waste-bauschutt", orderIndex: 60 },
  { domain: "method", label: "Bohrstock", slug: "method-bohrstock", orderIndex: 70 },
  { domain: "urgency", label: "Niedrig", slug: "urgency-niedrig", orderIndex: 80 },
  { domain: "urgency", label: "Mittel", slug: "urgency-mittel", orderIndex: 90 },
  { domain: "urgency", label: "Hoch", slug: "urgency-hoch", orderIndex: 100 },
  { domain: "theme", label: "Vegetation", slug: "theme-vegetation", orderIndex: 110 },
  { domain: "theme", label: "Boden", slug: "theme-boden", orderIndex: 120 },
  { domain: "theme", label: "Abfall", slug: "theme-abfall", orderIndex: 130 },
  { domain: "theme", label: "Erosion", slug: "theme-erosion", orderIndex: 140 },
  { domain: "theme", label: "Wasser", slug: "theme-wasser", orderIndex: 150 },
  { domain: "theme", label: "Sicherheit", slug: "theme-sicherheit", orderIndex: 160 },
  { domain: "theme", label: "Schadstelle", slug: "theme-schadstelle", orderIndex: 170 },
  { domain: "theme", label: "Monitoring", slug: "theme-monitoring", orderIndex: 180 }
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

export async function ensureDemoProjects(): Promise<void> {
  const requester = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", ["requester@example.com"]);
  const requesterId = requester.rows[0]?.id;
  if (!requesterId) {
    return;
  }

  await pool.query(
    `
    INSERT INTO projects (owner_user_id, name, description)
    SELECT $1, $2, $3
    WHERE NOT EXISTS (
      SELECT 1 FROM projects WHERE owner_user_id = $1 AND name = $2
    )
    `,
    [
      requesterId,
      "Demo Projekt Umweltmonitoring",
      "Vorseed fuer Projekt-Filter und Projekt-Report im MVP"
    ]
  );
}

export async function ensureDemoTaxonomyTerms(): Promise<void> {
  for (const term of demoTaxonomyTerms) {
    await pool.query(
      `
      INSERT INTO taxonomy_terms (domain, label, slug, active, order_index)
      VALUES ($1, $2, $3, true, $4)
      ON CONFLICT (slug) DO UPDATE
      SET
        domain = EXCLUDED.domain,
        label = EXCLUDED.label,
        active = true,
        order_index = EXCLUDED.order_index
      `,
      [term.domain, term.label, term.slug, term.orderIndex]
    );
  }
}
