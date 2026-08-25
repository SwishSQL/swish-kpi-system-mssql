# Server setup — Windows + SQL Server, app on port 6010

Everything below happens **on the server** (the machine running SQL Server).

## Prerequisites (one time)

1. **Node.js 18 LTS or newer** — https://nodejs.org → "LTS" installer → Next/Next/Finish.
   Verify in a new PowerShell window: `node --version`
2. **Git** (to clone the repo) — https://git-scm.com/download/win — or copy the
   project folder to the server by any other means (RDP file transfer, zip).
3. SQL Server is already installed and running (SSMS present). Have ready:
   - the SQL login (e.g. `sa`) and its password
   - the instance address — `localhost` and port `1433` for a default local instance

> SQL Server Authentication must be enabled (Mixed Mode). If only Windows
> Authentication is enabled: SSMS → right-click the server → Properties →
> Security → "SQL Server and Windows Authentication mode" → restart the
> SQL Server service.

## Install & run

Open **PowerShell** in the folder where you want the app, then:

```powershell
git clone https://github.com/swish-code/swish-kpi-system-mssql.git
cd swish-kpi-system-mssql
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

The script asks for the SQL host/port/database/login, then does everything:
creates the database if missing, writes `.env`, installs dependencies, applies
the migrations, seeds the permissions and the initial admin, builds, opens the
firewall port (when run as Administrator), and starts the app on **port 6010**.

When it finishes:

- Browse to **http://localhost:6010** (or `http://<server-ip>:6010` from
  another machine on the network).
- First login: **admin@swishhh.net** / temporary password **ADMIN-001**
  (a password change is forced immediately).

## Restarting later

The setup only needs to run once. To start the app again after a reboot:

```powershell
cd swish-kpi-system-mssql
npx next start -p 6010
```

To keep it running permanently in the background, install it as a scheduled
task that starts at boot (run once, as Administrator):

```powershell
schtasks /Create /TN "SWiSH KPI System" /SC ONSTART /RU SYSTEM /TR "cmd /c cd /d C:\path\to\swish-kpi-system-mssql && npx next start -p 6010"
```

(Replace `C:\path\to` with the real folder. `pm2` or NSSM work too if you
prefer a proper service manager.)

## Updating to a new version

```powershell
cd swish-kpi-system-mssql
git pull
npm install
npx prisma migrate deploy
npm run build
npx next start -p 6010
```

## If something fails

| Symptom | Likely cause |
|---|---|
| `Could not reach SQL Server` from the script | Wrong host/port/credentials, or SQL Server Authentication (Mixed Mode) is off — see prerequisites |
| `migrate deploy` fails naming a login error | Same as above — the `.env` connection string carries the same credentials |
| Port 6010 unreachable from other machines | Firewall rule missing — rerun the script as Administrator, or add the `netsh` rule it prints |
| `node` not recognised | Node installed but PowerShell window predates the install — open a new window |
