# Umwelt-Compliance Micro-Services (Vibe-Coding Bundle)
Datum: 2026-02-15

Dieses Bundle ist so geschrieben, dass es direkt in eine Vibe-Coding / Code-Gen Session (z.B. Codex, Cursor, etc.) gegeben werden kann.

## Empfohlener Ablauf (ohne Feature-Creep)
1) PRD lesen und Scope einfrieren (MVP nur Klasse 1 + Klasse 2 + QA).
2) TECH_SPEC als Architektur-Quelle setzen.
3) DATA_MODEL + schema.sql als Daten-Quelle setzen.
4) OPENAPI als API-Vertrag setzen (Server + Client generieren lassen).
5) UI_FLOW als Screen-Liste fuer das Frontend.

## „Golden Prompt“ fuer die Implementierung (copy/paste)
> Du bist Senior Fullstack Engineer. Implementiere das MVP exakt nach den Dokumenten:
> - 01_PRD.md
> - 02_TECHNICAL_SPEC.md
> - 03_DATA_MODEL.md + 03A_schema.sql
> - 04_API_OPENAPI.yaml
> - 05_UI_FLOW.md
> 
> Regeln:
> - Keine neuen Features erfinden.
> - Wenn etwas unklar ist, setze eine sinnvolle Default-Entscheidung und dokumentiere sie in /docs/DECISIONS.md.
> - Schreibe Tests fuer Kernlogik (Geo/Time Validation, Status-Transitions, RBAC).
> - Alles dockerisiert (Postgres + API + Web).

## MVP-Definition (kurz)
- Ticket erstellen (Auftraggeber)
- Ticket-Feed (Karte/Liste) (Ausfuehrende)
- Ticket annehmen + Checkliste
- Proof Upload (Foto + Meta + Pflichtfelder)
- QA Review (freigeben / nachfordern / ablehnen / eskalieren)
- Report (PDF Export pro Ticket/Projekt)

## Dateiliste
- 01_PRD.md
- 02_TECHNICAL_SPEC.md
- 03_DATA_MODEL.md
- 03A_schema.sql
- 04_API_OPENAPI.yaml
- 05_UI_FLOW.md
- 06_TASK_TEMPLATES.md
