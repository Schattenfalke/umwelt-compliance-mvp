# Umwelt Compliance MVP

> Ticketing, Proof und QA fuer auslagerbare Feldaufgaben im Umwelt-Compliance-Bereich.

---

## Was ist das?

Eine Web-Plattform, auf der wiederkehrende Umwelt-Compliance-Aufgaben
(Kontrollgaenge, Fotodokumentation, Bodenschutz-Monitoring) als Tickets erfasst,
von geeigneten Personen ausgefuehrt, per Proof (Foto + GPS + Checkliste)
nachgewiesen und durch QA freigegeben werden - mit vollstaendigem Audit-Trail
und PDF-Report.

---

## Warum?

Umweltauflagen erzeugen kleinteilige, wiederkehrende Feldaufgaben. Ohne Plattform:
- werden Fachkraefte mit Standardkontrollen gebunden
- sind Nachweise heterogen und lueckenhaft
- fehlt ein belastbarer Audit-Trail fuer Behoerden und Projektdokumentation

---

## Rollen

| Rolle | Aufgabe |
|-------|---------|
| Auftraggeber | Tickets erstellen, Status ueberwachen, Reports exportieren |
| Ausfuehrende | Tickets annehmen, Checkliste abarbeiten, Proof hochladen |
| QA | Proof pruefen, freigeben / nachfordern / eskalieren |
| Admin | Nutzer verwalten, Templates pflegen |

---

## Task-Klassen

- Klasse 1 - Crowd-faehig: Sichtkontrolle, Fotopunkt, einfache Zaehlungen
- Klasse 2 - Assistenz nach SOP: Standardisierte Taetigkeiten mit Anleitung
- Klasse 3 - Fachkraftpflicht: Eskalation, fachliche Beurteilung

---

## MVP-Funktionen

- Ticket erstellen (Ort, Geofence, Deadline, Proof-Policy)
- Mission Feed (Karte/Liste nach Distanz)
- Ticket annehmen plus Checkliste
- Proof Upload (Foto + GPS + Metadaten)
- QA Review (Freigabe / Nachforderung / Ablehnung / Eskalation)
- Audit-Trail (jede Statusaenderung nachvollziehbar)
- PDF Report

---

## Ticket-Lifecycle

```text
NEW -> QUALIFIED -> PUBLISHED -> ACCEPTED -> PROOF_SUBMITTED -> QA -> COMPLETED
```

---

## Tech-Stack

- Frontend: React + Vite
- Backend: Node.js / TypeScript
- Datenbank: PostgreSQL
- Deployment: Docker Compose

---

## Schnellstart (lokal)

```bash
git clone https://github.com/Schattenfalke/umwelt-compliance-mvp
cd umwelt-compliance-mvp
docker compose up --build
```

Dann im Browser:
- Web: http://localhost:3000
- API: http://localhost:8080

Demo-Zugaenge:

| Rolle | Email | Passwort |
|-------|-------|----------|
| Requester | requester@example.com | demo123 |
| Worker | worker@example.com | demo123 |
| QA | qa@example.com | demo123 |
| Admin | admin@example.com | demo123 |

---

## Durchgefuehrte Sprints

### Sprint 0 (abgeschlossen)
- DB-Schema aus `docs/03A_schema.sql` als Init-Setup integriert
- Docker-Setup fuer Postgres, API und Web aufgebaut
- Auth-Flow (Demo-Login) sowie RBAC-Grundlage umgesetzt
- Status-Machine, Geo/Time-Kernlogik und Core-Tests eingerichtet

### Sprint 1 (abgeschlossen)
- Ticket-Flow umgesetzt: Create, Qualify, Publish, Accept
- Worker-Mission-Feed mit Distanzfilter bereitgestellt
- 1-aktives-Ticket-Policy fuer Worker aktiv
- UI fuer Requester/Worker-Basisablauf implementiert

### Sprint 2 (abgeschlossen)
- Proof-Upload mit Pflichtfeldern, GPS/Zeit-Validierung und File-Metadaten umgesetzt
- QA-Review-Flow umgesetzt (Approve, Request Changes, Reject, Escalate)
- Audit-Trail fuer Status- und QA-Events persistiert
- Ticket-PDF-Report (`/tickets/{ticketId}/report.pdf`) umgesetzt

### Sprint 3 (abgeschlossen)
- Upload-Rate-Limit fuer Proofs (konfigurierbar ueber `PROOF_UPLOAD_RATE_LIMIT_*`)
- Admin-KPI-Snapshot (`GET /admin/metrics`) umgesetzt
- Template-API (`GET/POST/PATCH/DELETE /templates`) umgesetzt
- Template-Nutzung im Ticket-Create-Flow (`template_id`) integriert
- Admin-UI fuer KPI-Snapshot und Template-Verwaltung erweitert
- QA-Queue-Filter (`geo_fail`, `time_fail`, `exif_missing`) auf Proof-Ebene integriert
- Projekt-Basisflow (`GET/POST /projects`) und Projekt-PDF-Report (`GET /reports/project.pdf`) ergaenzt

### Sprint 4 (abgeschlossen)
- EXIF-Extraction beim Proof-Upload umgesetzt (GPS/Capture-Time Fallback aus Bildmetadaten)
- Redundanz-Policy (`proof_policy_json.redundancy`) fuer QA-Approve-Flow durchgesetzt
- Zusaeztliche Proof-Uploads in `PROOF_SUBMITTED` fuer Redundanz-Faelle ermoeglicht
- QA Proof Viewer erweitert: echte Bildanzeige, Metadaten und Map-Preview
- API-Endpunkt fuer Proof-Dateistreaming (`GET /proofs/{proofId}/files/{fileId}`) hinzugefuegt
- Worker Mission Feed und Requester Ticket-Create um Karten-Preview erweitert

---

## Pilot-Use-Case: Vegetations-/Bodenschutz-Monitoring

Regelmaessige Fotodokumentation an definierten Geo-Punkten (alle 14 Tage):
- 2 Fotos (Uebersicht + Detail)
- GPS-Validierung (Geofence 25m)
- Pflichtfeld: Wuchsstatus (ok / zu niedrig / nicht vorhanden)
- Redundanz: 2 unabhaengige Proofs
- Trigger bei Abweichung: automatisches Interventionsticket (Klasse 2)

---

## Roadmap

| Phase | Zeitraum | Fokus |
|-------|----------|-------|
| Sprint 0 | abgeschlossen | Docker, Schema, Auth, RBAC |
| Sprint 1 | abgeschlossen | Ticketing, Feed, Annahme |
| Sprint 2 | abgeschlossen | Proof Upload, QA Review, PDF Report |
| Sprint 3 | abgeschlossen | KPIs, Templates, Hardening-Bausteine |
| Sprint 4 | abgeschlossen | EXIF, Redundanz, QA Viewer, Karten-Previews |

---

## Status

MVP ist funktionsfaehig umgesetzt (Sprints 0 bis 4).

---

Konzept und Entwicklung: Robin Adler - robin-adler.de
