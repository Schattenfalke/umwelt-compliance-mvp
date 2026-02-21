# TECH SPEC — Architektur & Stack (MVP)

## 1) Architektur (minimal, produktionsfaehig)
- Web Frontend (Next.js oder React + Vite)
- API (Node.js/TypeScript, z.B. NestJS oder Express + zod)
- DB (PostgreSQL)
- Object Storage fuer Proof-Dateien (S3 kompatibel: MinIO lokal, spaeter AWS/S3/Hetzner)
- Background Jobs (BullMQ/Redis optional; im MVP kann es Cron/Queue light sein)
- PDF Rendering (serverseitig, z.B. Puppeteer/Playwright HTML→PDF oder ReportLab wenn Python-Service)

## 2) Grund-Entscheidungen (Default)
- Auth: Magic Link / Email+Passwort (einfach); spaeter SSO
- RBAC: role in JWT + serverseitige Guards
- Geo: PostGIS optional; im MVP: Haversine + einfache Geofence Berechnung in Code
- Files: Signed Upload URL (S3 presigned) oder API Upload Endpoint (einfacher Start: API Upload)

## 3) Modul-Schnitt
### 3.1 Ticket Service
- CRUD Tickets
- Status Transitions (State Machine)
- Visibility rules (Ausspielung)

### 3.2 Proof Service
- Upload, Metadaten-Extraktion, Validierung (Geo/Zeit)
- Versionierung / mehrere Proofs pro Ticket
- Redundanz-Handling

### 3.3 QA Service
- Review Queue
- Actions: approve / request_changes / reject / escalate
- Audit logging

### 3.4 Reporting Service
- HTML Template + Render zu PDF
- Zusammenstellung Proofs (thumbnails) + Statushistorie

## 4) Status Machine (MVP)
Allowed transitions:
- NEW -> QUALIFIED
- QUALIFIED -> PUBLISHED
- PUBLISHED -> ACCEPTED
- ACCEPTED -> PROOF_SUBMITTED
- PROOF_SUBMITTED -> QA_REVIEW (optional, intern)
- PROOF_SUBMITTED -> COMPLETED (nur via QA approve)
- PROOF_SUBMITTED -> NEEDS_CHANGES
- NEEDS_CHANGES -> PROOF_SUBMITTED
- PROOF_SUBMITTED -> REJECTED (optional)
- REJECTED -> PUBLISHED (Rework) oder ARCHIVED

## 5) Security / Compliance (MVP)
- Proof-Dateien niemals public; nur signed URLs
- PII minimieren (Name optional, DisplayName ok)
- Audit Trail: jede Statusaenderung + QA Entscheidung persistieren
- Rate limiting fuer Uploads
- Content policy: Uploads auf Dateityp und Groesse begrenzen

## 6) Observability
- Request-IDs, strukturierte Logs (pino)
- Minimal metrics: count tickets, avg QA time
- Error tracking (Sentry optional)

## 7) Deployment (lokal + staging)
- docker-compose: postgres, api, web, minio
- Migrations via Prisma/Drizzle/Knex oder plain SQL

## 8) Tech Debt bewusst akzeptiert (MVP)
- Keine Offline-Unterstuetzung
- Keine Bildanalyse (nur Metadaten + QA)
- Kein komplexes Skill-Matching; nur Tags
