import { pool } from "./db";

const demoUsers = [
  { email: "admin@example.com", displayName: "Admin", role: "ADMIN" },
  { email: "requester@example.com", displayName: "Requester", role: "REQUESTER" },
  { email: "worker@example.com", displayName: "Worker", role: "WORKER" },
  { email: "qa@example.com", displayName: "QA", role: "QA" }
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
