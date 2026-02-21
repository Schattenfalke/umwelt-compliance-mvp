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

## Sprint-3 Features

- Upload-Rate-Limit fuer Proofs (konfigurierbar ueber `PROOF_UPLOAD_RATE_LIMIT_*`)
- Admin KPIs unter `GET /admin/metrics`
- Template API unter `GET/POST/PATCH/DELETE /templates`
- Requester kann Tickets optional aus Templates erstellen (`template_id`)

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
| Sprint 0 | Woche 1 | Docker, Schema, Auth, Grundgeruest |
| Sprint 1 | Woche 2-3 | Ticketing, Feed, Annahme |
| Sprint 2 | Woche 4-5 | Proof Upload, QA Review, PDF Report |
| Sprint 3 | Woche 6-8 | Pilot-Betrieb, KPIs, Hardening |

---

## Status

MVP in Entwicklung.

---

Konzept und Entwicklung: Robin Adler - robin-adler.de
