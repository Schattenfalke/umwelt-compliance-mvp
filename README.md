# Umwelt Compliance MVP

> Ticketing, Proof & QA für auslagerbare Feldaufgaben im Umwelt-Compliance-Bereich.

---

## Was ist das?

Eine Web-Plattform, auf der wiederkehrende Umwelt-Compliance-Aufgaben (Kontrollgänge, Fotodokumentation, Bodenschutz-Monitoring) als Tickets erfasst, von geeigneten Personen ausgeführt, per Proof (Foto + GPS + Checkliste) nachgewiesen und durch QA freigegeben werden — mit vollständigem Audit-Trail und PDF-Report.

---

## Warum?

Umweltauflagen erzeugen kleinteilige, wiederkehrende Feldaufgaben. Ohne Plattform:
- werden Fachkräfte mit Standardkontrollen gebunden
- sind Nachweise heterogen und lückenhaft
- fehlt ein belastbarer Audit-Trail für Behörden und Projektdokumentation

---

## Rollen

| Rolle | Aufgabe |
|-------|---------|
| **Auftraggeber** | Tickets erstellen, Status überwachen, Reports exportieren |
| **Ausführende** | Tickets annehmen, Checkliste abarbeiten, Proof hochladen |
| **QA** | Proof prüfen, freigeben / nachfordern / eskalieren |
| **Admin** | Nutzer verwalten, Templates pflegen |

---

## Task-Klassen

- **Klasse 1** — Crowd-fähig: Sichtkontrolle, Fotopunkt, einfache Zählungen
- **Klasse 2** — Assistenz nach SOP: Standardisierte Tätigkeiten mit Anleitung
- **Klasse 3** — Fachkraftpflicht: Eskalation, fachliche Beurteilung

---

## MVP-Funktionen

- ✅ Ticket erstellen (Ort, Geofence, Deadline, Proof-Policy)
- ✅ Mission Feed (Karte/Liste nach Distanz)
- ✅ Ticket annehmen + Checkliste
- ✅ Proof Upload (Foto + GPS + Metadaten)
- ✅ QA Review (Freigabe / Nachforderung / Ablehnung / Eskalation)
- ✅ Audit-Trail (jede Statusänderung nachvollziehbar)
- ⏳ PDF Report (Sprint 2)

---

## Ticket-Lifecycle

```
NEU → QUALIFIZIERT → VERÖFFENTLICHT → ANGENOMMEN → PROOF → QA → ABSCHLUSS
```

---

## Tech-Stack

- **Frontend**: React + Vite
- **Backend**: Node.js / TypeScript
- **Datenbank**: PostgreSQL
- **File Storage**: S3-kompatibel (MinIO lokal)
- **Deployment**: Docker Compose

---

## Schnellstart (lokal)

```bash
git clone https://github.com/Schattenfalke/umwelt-compliance-mvp
cd umwelt-compliance-mvp
docker-compose up --build
```

Dann im Browser:
- Web: http://localhost:3000
- API: http://localhost:8080

**Demo-Zugänge:**

| Rolle | Email | Passwort |
|-------|-------|----------|
| Requester | requester@example.com | demo123 |
| Worker | worker@example.com | demo123 |
| QA | qa@example.com | demo123 |

---

## Pilot-Use-Case: Vegetations-/Bodenschutz-Monitoring

Regelmäßige Fotodokumentation an definierten Geo-Punkten (alle 14 Tage):
- 2 Fotos (Übersicht + Detail)
- GPS-Validierung (Geofence 25m)
- Pflichtfeld: Wuchsstatus (ok / zu niedrig / nicht vorhanden)
- Redundanz: 2 unabhängige Proofs
- Trigger bei Abweichung: automatisches Interventionsticket (Klasse 2)

---

## Roadmap

| Phase | Zeitraum | Fokus |
|-------|----------|-------|
| Sprint 0 | ✅ Woche 1 | Docker, Schema, Auth, Grundgerüst |
| Sprint 1 | Woche 2-3 | Ticketing, Feed, Annahme |
| Sprint 2 | Woche 4-5 | Proof Upload, QA Review, PDF Report |
| Sprint 3 | Woche 6-8 | Pilot-Betrieb, KPIs, Hardening |

---

## Status

> 🚧 MVP in Entwicklung — Sprint 0 abgeschlossen, Sprint 1 läuft.

---

*Konzept & Entwicklung: Robin Adler — robin-adler.de*
