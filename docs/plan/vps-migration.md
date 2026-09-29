# Plan: Moving RMC Crypto from MacBook to Linux VPS

> **Status:** Planned / Architecture & Operations  
> **Date:** 2026-09-26  
> **Goal:** Migrate the RMC Crypto & Market Intelligence Platform from a local MacBook to a 24/7 Linux VPS with automated background scheduling, process supervision, hardened database access, and SSL reverse proxy.

---

## 1. Executive Summary & Why Migrate

Currently, RMC runs locally on a development MacBook:
* **Database:** TimescaleDB in Docker Desktop.
* **App:** Next.js on port `7070` via `pnpm dev`.
* **Crons & Alerts:** Signal evaluation relies on `useAlertPoller.ts` (client-side polling every 60s while a browser tab is open). When the laptop sleeps or the browser is closed, all strategy alerts, news crawlers, and sentiment jobs stop.

### Target State on VPS
* **24/7 Uptime:** Uninterrupted candle ingestion, strategy signal evaluation, news crawlers, and instant Telegram alerts.
* **Decoupled Client & Server:** Access the terminal from any device (phone, laptop, tablet) via secure HTTPS without keeping a local server running.
* **Hardened Security:** Database bound exclusively to `127.0.0.1`, rate-limited API reverse proxy, and access-gate authentication.
* **Low Maintenance:** Zero-downtime updates powered by `./updateCode.sh --prod` and PM2 process supervision.

---

## 2. Architecture Comparison

```
Current (MacBook Dev):
[Browser Tab Open] ──(60s poll)──► Next.js (Port 7070) ──► Docker Desktop (TimescaleDB :5432)
       ▲
       └── Sleeping laptop = NO background alerts, NO crawlers

Target (Linux VPS Production):
[Client Devices] ──(HTTPS + Auth)──► Nginx / Caddy (:443)
                                            │
                                            ▼ (Reverse Proxy)
[Linux Crontab] ──(Curl + Secret)─► Next.js (PM2 :3000) ──► Docker Engine (TimescaleDB 127.0.0.1:5432)
                                            │
                                            ▼
                                  Telegram Bot Alerts / AI APIs
```

---

## 3. Server Specifications & Prerequisites

### 3.1 Recommended VPS Specs
| Component | Minimum | Recommended | Notes |
|---|---|---|---|
| **CPU** | 1 vCPU | 2 vCPUs | Next.js production build (`next build`) is CPU-heavy |
| **RAM** | 2 GB (+ 2GB Swap) | 4 GB | TimescaleDB + Next.js build requires ~2.5GB peak |
| **Storage** | 25 GB SSD | 40 GB+ NVMe SSD | TimescaleDB hypertable candle storage grows over time |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS | Debian 12 is also supported |

### 3.2 Firewall & Ports
* **Port 22 (SSH):** Accessible via public-key only.
* **Port 80 (HTTP):** Open for Certbot / Let's Encrypt SSL challenges & HTTP-to-HTTPS redirect.
* **Port 443 (HTTPS):** Open for public access to the dashboard.
* **Port 5432 (Postgres):** **CLOSED** to the internet (bound to `127.0.0.1` inside Docker).
* **Port 3000/7070 (Next.js):** **CLOSED** to the internet (proxied internally by Nginx/Caddy).

---

## 4. Security & Access Protection

> [!WARNING]
> **Authentication Requirement:**
> RMC is designed as a personal single-user dashboard. In code, `APP_PASSWORD` is not yet enforced as a middleware gate. Exposing the VPS web port directly to the internet exposes your API keys (Gemini, Claude, Telegram), custom strategies, and database.

### Recommended Access Protection: HTTP Basic Auth on Reverse Proxy
Place an authentication gate at the reverse proxy layer (Nginx or Caddy) before requests hit Next.js.
* Browser will prompt once for credentials and remember the session.
* Blocks web crawlers, vulnerability scanners, and unauthorized visitors completely.
* Alternative options: **Cloudflare Zero Trust Tunnel** (recommended if you want Google SSO login and no open inbound ports) or **Tailscale** (private VPN mesh).

---

## 5. End-to-End Migration Phases

### Phase 1: VPS Provisioning & System Hardening
1. Connect as root: `ssh root@<vps-ip>`.
2. Create dedicated deploy user and grant sudo:
   ```bash
   adduser deploy
   usermod -aG sudo deploy
   rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
   ```
3. Harden SSH (`/etc/ssh/sshd_config`):
   * `PermitRootLogin no`
   * `PasswordAuthentication no`
   * Restart SSH: `sudo systemctl restart ssh`
4. Setup UFW Firewall:
   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
5. Setup 2GB Swap File (prevents OOM during Next.js builds):
   ```bash
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

---

### Phase 2: Runtime Environment Installation
Install Docker, Node.js 22 LTS, and PM2:

```bash
# 1. Install Docker & Compose Plugin
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy

# 2. Install Node.js 22 & PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pnpm pm2
```

---

### Phase 3: Database Setup & Migration

#### 3.1 Hardened Docker Compose Configuration
On the VPS, `docker-compose.yml` must bind Postgres strictly to `127.0.0.1` and use a strong production password:

```yaml
version: '3.9'

services:
  db:
    image: timescale/timescaledb:latest-pg16
    container_name: rmc_db
    restart: unless-stopped
    ports:
      - '127.0.0.1:5432:5432'
    environment:
      POSTGRES_USER: rmc
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-change_to_strong_secret}
      POSTGRES_DB: rmc_crypto
    volumes:
      - rmc_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U rmc -d rmc_crypto']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  rmc_pgdata:
```

#### 3.2 Data Migration: MacBook ➔ VPS
Choose one of the two options:

* **Option A: Full Transfer (Preserve historical candles, strategies & settings)**
  1. *On MacBook:*
     ```bash
     docker exec -t rmc_db pg_dump -U rmc -d rmc_crypto -Fc -f /tmp/rmc_backup.dump
     scp /tmp/rmc_backup.dump deploy@<vps-ip>:/tmp/
     ```
  2. *On VPS:*
     ```bash
     docker compose up -d
     # Wait until rmc_db is healthy:
     docker compose ps
     docker exec -i rmc_db pg_restore -U rmc -d rmc_crypto --clean --if-exists /tmp/rmc_backup.dump
     ```

* **Option B: Clean Start (Fresh database)**
  1. *On VPS:* Start container: `docker compose up -d`.
  2. Run migration script: `pnpm run migrate` (creates all tables and Timescale hypertables). Candles will backfill automatically on first chart view.

---

### Phase 4: App Deployment & PM2 Supervisor

1. **Clone Repo & Configure Environment:**
   ```bash
   git clone <repo-url> /home/deploy/rmc-crypto
   cd /home/deploy/rmc-crypto
   cp .env.example .env.local
   ```
2. **Update `.env.local` with Production Secrets:**
   ```bash
   DATABASE_URL=postgresql://rmc:<strong_password>@localhost:5432/rmc_crypto
   CRON_SECRET=<generate_random_secret_with_openssl_rand_hex_32>
   GEMINI_API_KEY=...
   TELEGRAM_BOT_TOKEN=...
   ANTHROPIC_API_KEY=...
   REDDIT_CLIENT_ID=...
   REDDIT_CLIENT_SECRET=...
   ```
3. **PM2 Ecosystem Configuration (`ecosystem.config.cjs`):**
   ```javascript
   module.exports = {
     apps: [
       {
         name: 'rmc-crypto',
         script: 'npm',
         args: 'run start -- -p 3000',
         cwd: '/home/deploy/rmc-crypto',
         instances: 1,
         autorestart: true,
         watch: false,
         max_memory_restart: '1G',
         env: {
           NODE_ENV: 'production',
           PORT: 3000,
         },
       },
     ],
   };
   ```
4. **Build & Start Service:**
   ```bash
   pnpm install
   pnpm run build
   pm2 start ecosystem.config.cjs
   pm2 startup
   pm2 save
   ```

---

### Phase 5: Automated 24/7 Cron Jobs

On the VPS, background scheduled jobs run autonomously via Linux system crontab without needing any browser open.

Run `crontab -e` as `deploy` user and insert:

```cron
# ─── RMC Crypto Scheduled Automated Tasks ──────────────────────────────────────
CRON_SECRET=your_production_cron_secret_here

# 1. Strategy signals & indicator alerts (every 1 min)
* * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/check-alerts > /dev/null 2>&1

# 2. AI Sentiment batch classification (every 5 min)
*/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sentiment-run > /dev/null 2>&1

# 3. Polymarket prediction odds (every 10 min)
*/10 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/crawl-polymarket > /dev/null 2>&1

# 4. Crypto RSS news feeds (every 15 min)
*/15 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/crawl-rss > /dev/null 2>&1

# 5. Nitter/X analyst posts (every 20 min)
*/20 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/crawl-nitter > /dev/null 2>&1

# 6. Reddit community crawl (every 30 min)
*/30 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/crawl-reddit > /dev/null 2>&1
```

---

### Phase 6: Reverse Proxy & SSL Setup

#### Option A: Caddy (Recommended for Simplicity & Automatic SSL)
```bash
sudo apt install -y caddy
sudo caddy hash-password --plaintext "YourStrongPassword"
# Copy generated hash into /etc/caddy/Caddyfile
```

`/etc/caddy/Caddyfile`:
```caddy
yourdomain.com {
    basicauth / {
        rmcadmin $2a$14$HASHED_PASSWORD_FROM_COMMAND_ABOVE
    }

    reverse_proxy localhost:3000
}
```
Reload Caddy: `sudo systemctl reload caddy`.

#### Option B: Nginx + Certbot
```bash
sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx
sudo htpasswd -c /etc/nginx/.htpasswd rmcadmin
```

`/etc/nginx/sites-available/rmc`:
```nginx
server {
    server_name yourdomain.com;

    location / {
        auth_basic "RMC Protected Area";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Enable & generate SSL:
```bash
sudo ln -s /etc/nginx/sites-available/rmc /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com
```

---

## 6. Continuous Deployment Workflow

Future updates are completely streamlined using the existing `updateCode.sh` and the `update-code` skill:

```bash
# Push updates from MacBook / local dev:
git push origin main

# On VPS (or via remote SSH):
cd /home/deploy/rmc-crypto
./updateCode.sh --prod
```

`updateCode.sh` automatically:
1. Detects upstream commits and pulls changes (`git pull`).
2. Detects dependency changes in `package.json` and runs `pnpm install`.
3. Detects schema changes in `schema.sql` and executes `pnpm run migrate`.
4. Rebuilds the Next.js bundle (`pnpm run build`).
5. Restarts the PM2 process seamlessly (`pm2 restart rmc-crypto`).
6. Verifies HTTP 200 live status.

---

## 7. Verification & Health Check Checklist

- [ ] **Docker:** `docker compose ps` shows `rmc_db` status `healthy` on `127.0.0.1:5432`.
- [ ] **PM2:** `pm2 list` shows `rmc-crypto` is `online` with 0 restarts.
- [ ] **Local HTTP Check:** `curl -I http://localhost:3000/` returns `HTTP 200 OK`.
- [ ] **Cron Manual Test:** `curl -s -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/check-alerts` returns `{"ok":true}`.
- [ ] **External HTTPS & Auth:** Visiting `https://yourdomain.com` prompts for Basic Auth; upon login, the dashboard opens cleanly.
- [ ] **Live Price Streaming:** Binance miniTicker WebSocket pushes real-time prices to the watchlist.
- [ ] **Chart & Indicators:** BTCUSDT chart renders with EMA, RSI, and MACD overlays.
- [ ] **Telegram Notification Test:** Trigger a test signal or alert in `/settings` and verify delivery to your Telegram chat/topic.
