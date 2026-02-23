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
- Projektpflicht fuer alle Tickets
- Mission Feed (Karte/Liste nach Distanz)
- Bottom-up Hinweis durch Worker (Text + Standort + Foto) -> Ticket in `NEW`
- Kanban-Board mit Drag&Drop Status-Updates (serverseitig RBAC + State-Machine validiert)
- Zentrale Taxonomie-Tags und kombinierte Suche (z. B. Luzerne + Datum)
- Ticket annehmen plus Checkliste
- Proof Upload (Foto + GPS + Metadaten)
- QA Review (Freigabe / Nachforderung / Ablehnung / Eskalation)
- Audit-Trail (jede Statusaenderung nachvollziehbar)
- PDF Report
- KA5-nahe Exporte (`/exports/ka5.csv`, `/exports/ka5.json`)
- PWA-Basis (installierbar, Service Worker, Push-Subscription-Basis)
- In-App Hilfe (Onboarding + FAQ)

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

## GitHub Pages (Web)

Das Frontend wird per GitHub Actions aus `web/` gebaut und nach Pages deployed.

1. `Settings -> Pages -> Source` auf **GitHub Actions** stellen.
2. `Settings -> Secrets and variables -> Actions -> Variables`:
   - Variable `VITE_API_URL` anlegen (oeffentliche API-URL, z. B. `https://<deine-api-domain>`).
3. Push auf `main` oder Workflow manuell starten.

Wichtig:
- Bei Pages kann man als Branch-Quelle nur `/(root)` oder `/docs` waehlen, nicht `/web`.
- Ohne gesetzte `VITE_API_URL` bricht der Pages-Workflow bewusst mit Fehlermeldung ab.

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

### Sprint 5 (abgeschlossen)
- Projektpflicht technisch durchgesetzt (`tickets.project_id` NOT NULL inkl. Runtime-Migration)
- Date/Time-UX ueberarbeitet: getrennte Datum/Uhrzeit-Felder, API-Normalisierung auf ISO UTC
- Worker-Hinweisfluss erweitert: `POST /tickets/hints` mit Pflichtfeldern Text + Standort + Foto
- Taxonomie-Modell eingefuehrt (`taxonomy_terms`, `ticket_taxonomy`) inkl. Filter/Suche in `GET /tickets`
- Kanban-Endpoint (`POST /tickets/{ticketId}/move`) + Web-Board mit Drag&Drop umgesetzt
- Push-Basis umgesetzt (`push_subscriptions`, `notification_events`) inkl. Klasse-3 Routing (QA + Requester)
- KA5-nahe Exportprofile als CSV/JSON umgesetzt (`/exports/ka5.csv`, `/exports/ka5.json`)
- Bohrstock-Template auf strukturierte Felder erweitert
- Hilfebereich in der App umgesetzt (Onboarding + FAQ)

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
| Sprint 5 | abgeschlossen | Projektpflicht, Taxonomie, Kanban, Hint-Flow, PWA/Push, KA5-Export, Hilfe |

---

## Status

MVP ist funktionsfaehig umgesetzt (Sprints 0 bis 5).

---

Konzept und Entwicklung: Robin Adler - robin-adler.de
