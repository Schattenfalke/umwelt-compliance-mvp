# Kunden-Deployment Runbook (Interne IT)

Dieses Runbook beschreibt den Betrieb des MVP in einer internen Kundenumgebung mit Docker Compose.

## Architektur (Default)

- `edge` (nginx) als interner Einstiegspunkt
- `web` (Vite-Build, statisch via nginx)
- `api` (Node.js/Express)
- `postgres` (PostgreSQL 16)
- Persistenz:
  - DB-Daten: Docker-Volume `postgres_data`
  - Upload-Dateien: Docker-Volume `api_uploads`

## Voraussetzungen

- Linux-VM oder Windows Server mit Docker Engine + Compose Plugin
- Interne DNS-Aufloesung (z. B. `umwelt-app.kunde.local`)
- TLS-Termination ueber vorhandene Kunden-Infrastruktur (Reverse Proxy / WAF / Load Balancer)

## Initiale Inbetriebnahme

1. Aus dem Repository-Root arbeiten.
2. Env-Datei anlegen:

```powershell
Copy-Item deploy/customer/.env.example deploy/customer/.env
```

3. `deploy/customer/.env` anpassen:
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `AUTH_DEMO_PASSWORD`
- `APP_ORIGIN` (interne URL)
- `PUBLIC_API_BASE_URL` (normalerweise `${APP_ORIGIN}/api`)

4. Starten:

```powershell
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env up --build -d
```

Hinweis: Beim ersten Start spielt Postgres automatisch `db/init.sql` ein.

## Verifikation

```powershell
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env ps
curl http://localhost:80/health
curl http://localhost:80/api/health
```

Erwartung:
- `/health` liefert `ok`
- `/api/health` liefert `{"ok":true}`

Wenn `HTTP_PORT` in `.env` geaendert wurde, ersetze `80` entsprechend.

## Update-Prozess

```powershell
git pull
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env up --build -d
```

Optional veraltete Images entfernen:

```powershell
docker image prune -f
```

## Logs und Troubleshooting

```powershell
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env logs -f edge
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env logs -f api
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env logs -f postgres
```

Typische Fehler:
- `relation "users" does not exist`: DB wurde ohne Init gestartet oder falsches Volume/DB verwendet.
- CORS-Fehler: `APP_ORIGIN` und `PUBLIC_API_BASE_URL` stimmen nicht mit der aufgerufenen URL ueberein.
- Upload-Probleme: `MAX_UPLOAD_BYTES` oder `client_max_body_size` zu klein.

## Backup

Backup-Ordner anlegen:

```powershell
New-Item -ItemType Directory -Force deploy/customer/backups | Out-Null
```

SQL-Dump erstellen:

```powershell
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "deploy/customer/backups/umwelt_$ts.sql"
```

## Restore

Warnung: Restore ueberschreibt Daten nur dann sauber, wenn Ziel-DB geleert oder neu erstellt wurde.

```powershell
Get-Content "deploy/customer/backups/<backup-file>.sql" -Raw | docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Stoppen

```powershell
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env down
```

Mit Loeschen der Volumes (nur wenn explizit gewollt):

```powershell
docker compose -f deploy/customer/docker-compose.customer.yml --env-file deploy/customer/.env down -v
```
