<#
One-shot setup for the SWiSH KPI System (SQL Server edition) on a Windows
server. Run from the repository root in PowerShell:

    powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

What it does, in order:
  1. Checks Node.js 18+ is installed.
  2. Prompts for the SQL Server connection (host, port, database, user,
     password) with sensible defaults for a local instance.
  3. Creates the database if it does not exist (via sqlcmd).
  4. Writes .env with the connection string and generated secrets.
  5. npm install, prisma migrate deploy, seed, production build.
  6. Optionally opens the app port in Windows Firewall (needs admin).
  7. Starts the app on the chosen port (default 6010).

Re-running is safe: the database create is IF NOT EXISTS, migrations are
idempotent, the seed is idempotent, and .env is only rewritten after a
confirmation prompt.
#>
param(
  [string]$SqlServerHost = "localhost",
  [int]$SqlPort = 1433,
  [string]$Database = "swish_kpi",
  [string]$SqlUser = "sa",
  [string]$SqlPassword = "",
  [int]$AppPort = 6010,
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- repo root check -------------------------------------------------------
if (-not (Test-Path "package.json") -or -not (Test-Path "prisma\schema.prisma")) {
  Fail "Run this from the repository root (the folder containing package.json)."
}

# --- 1. Node ---------------------------------------------------------------
Step "Checking Node.js"
try { $nodeVer = (& node --version) } catch { $nodeVer = $null }
if (-not $nodeVer) {
  Fail "Node.js is not installed or not on PATH. Install the LTS build from https://nodejs.org (18 or newer), reopen PowerShell, and run this script again."
}
$major = [int]($nodeVer.TrimStart("v").Split(".")[0])
if ($major -lt 18) { Fail "Node $nodeVer found, but 18+ is required." }
Write-Host "Node $nodeVer"

# --- 2. Connection details -------------------------------------------------
Step "SQL Server connection"
$inHost = Read-Host "SQL Server host [$SqlServerHost]"
if ($inHost) { $SqlServerHost = $inHost }
$inPort = Read-Host "SQL Server port [$SqlPort]"
if ($inPort) { $SqlPort = [int]$inPort }
$inDb = Read-Host "Database name [$Database]"
if ($inDb) { $Database = $inDb }
$inUser = Read-Host "SQL login [$SqlUser]"
if ($inUser) { $SqlUser = $inUser }
while (-not $SqlPassword) {
  $sec = Read-Host "Password for $SqlUser" -AsSecureString
  $SqlPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# --- 3. Create the database if missing ------------------------------------
Step "Creating database [$Database] if it does not exist"
$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if ($sqlcmd) {
  & sqlcmd -S "$SqlServerHost,$SqlPort" -U $SqlUser -P $SqlPassword -b -Q "IF DB_ID('$Database') IS NULL CREATE DATABASE [$Database];"
  if ($LASTEXITCODE -ne 0) { Fail "Could not reach SQL Server or create the database. Check the host, port and credentials." }
  Write-Host "Database ready."
} else {
  Write-Host "sqlcmd not found - create the database manually in SSMS if it does not exist yet:" -ForegroundColor Yellow
  Write-Host "    CREATE DATABASE [$Database];" -ForegroundColor Yellow
  Read-Host "Press Enter once the database exists"
}

# --- 4. .env ---------------------------------------------------------------
Step "Writing .env"
if (Test-Path ".env") {
  $overwrite = Read-Host ".env already exists. Overwrite it? (y/N)"
  if ($overwrite -ne "y") { Write-Host "Keeping the existing .env." }
}
if (-not (Test-Path ".env") -or $overwrite -eq "y") {
  # Random secrets; the app derives session/encryption material from these.
  # 48 picks WITH replacement - Get-Random -Count picks without and would
  # refuse to draw 48 from a 36-character alphabet.
  $rand = { -join (1..48 | ForEach-Object { [char](Get-Random -InputObject ((48..57) + (97..122))) }) }
  $lines = @(
    "DATABASE_URL=sqlserver://${SqlServerHost}:${SqlPort};database=${Database};user=${SqlUser};password=${SqlPassword};encrypt=true;trustServerCertificate=true",
    "APP_URL=http://localhost:$AppPort",
    "SESSION_SECRET=$(& $rand)",
    "ENCRYPTION_KEY=$(& $rand)",
    "STORAGE_DRIVER=db",
    "MAX_FILE_SIZE_MB=10",
    "MAX_FILES_PER_KPI=5",
    "INITIAL_ADMIN_EMPLOYEE_ID=ADMIN-001",
    "INITIAL_ADMIN_EMAIL=admin@swishhh.net",
    "INITIAL_ADMIN_NAME=System Administrator",
    "INITIAL_ADMIN_PASSWORD=",
    "PORT=$AppPort"
  )
  # ASCII, no BOM - a BOM in .env breaks dotenv parsing of the first key.
  [IO.File]::WriteAllLines((Join-Path (Get-Location) ".env"), $lines)
  Write-Host ".env written."
}

# --- 5. Install, migrate, seed, build --------------------------------------
Step "Installing dependencies (npm install)"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }

Step "Applying database migrations (prisma migrate deploy)"
& npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Fail "Migration failed - the output above names the statement that broke." }

Step "Seeding permissions, roles and the initial admin"
& npx tsx prisma/seed.ts
if ($LASTEXITCODE -ne 0) { Fail "Seed failed." }

Step "Building the production bundle (next build)"
& npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed." }

# --- 6. Firewall (optional) ------------------------------------------------
Step "Windows Firewall"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  $ruleName = "SWiSH KPI System (port $AppPort)"
  $existing = netsh advfirewall firewall show rule name="$ruleName" 2>$null
  if ($LASTEXITCODE -ne 0) {
    netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$AppPort | Out-Null
    Write-Host "Inbound rule added for TCP $AppPort."
  } else {
    Write-Host "Firewall rule already present."
  }
} else {
  Write-Host "Not running as Administrator - if other machines must reach the app, open TCP $AppPort manually:" -ForegroundColor Yellow
  Write-Host "    netsh advfirewall firewall add rule name=`"SWiSH KPI System`" dir=in action=allow protocol=TCP localport=$AppPort" -ForegroundColor Yellow
}

# --- 7. Start --------------------------------------------------------------
if ($SkipStart) {
  Write-Host "`nSetup complete. Start the app with:  npx next start -p $AppPort" -ForegroundColor Green
} else {
  Step "Starting on http://localhost:$AppPort  (Ctrl+C to stop)"
  Write-Host "First login: admin@swishhh.net / temporary password ADMIN-001 (forced change)." -ForegroundColor Green
  & npx next start -p $AppPort
}
