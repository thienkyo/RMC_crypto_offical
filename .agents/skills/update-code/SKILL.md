---
name: update-code
description: Pulls the latest code from git, checks if package installation or database migration is needed, runs those steps, builds, and restarts the Next.js project. Use when requested to deploy, redeploy, pull code, update code, run updateCode, or restart the server.
---

# Update Code and Restart Project

## Overview
This skill provides a programmatic, safe way for the agent to pull changes from the remote repository, check if dependencies or database schemas have changed, execute any required tasks, and restart the Next.js application.

## Prerequisites
- The project must have `updateCode.sh` in the root directory.
- The project scripts must contain `"updateCode": "./updateCode.sh"` in `package.json`.

## Quick Start
To trigger this skill, the user can ask:
- "Please update the codebase and restart the server."
- "Redeploy the application in production mode."
- "Run updateCode to pull changes."

## Workflow
When triggered, follow these steps:

1. **Identify the Mode**:
   - Check if the user specified a mode (development or production).
   - If not specified, default to **development** (`--dev`).
   - If production is requested, use the `--prod` flag.

2. **Run the Script**:
   - Run the script via the project root directory.
   - Use the registered npm script: `npm run updateCode -- [options]` (or `./updateCode.sh [options]` directly).
   - Recommended flags:
     - Run development: `./updateCode.sh --dev`
     - Run production: `./updateCode.sh --prod`
     - Force full check & restart: `./updateCode.sh --force`
     - Customize port: `./updateCode.sh --port <port-number>`

3. **Verify Execution**:
   - Check the stdout and exit code. An exit code of `0` indicates success.
   - If the script outputs `Project started successfully!`, extract the new PID from `.app.pid` or read it from stdout.
   - If starting failed, review the respective log file (`dev.log` for development mode, `prod.log` for production mode) to analyze error logs (like port conflict `EADDRINUSE` or runtime/compilation errors).

## Troubleshooting & Common Mistakes

### 1. Hardcoded Port Conflict
If the server fails to restart due to `EADDRINUSE` on port 7070, it is because Next.js has port 7070 hardcoded in `package.json`.
- The script automatically bypasses this if a custom port is set by running `npx next dev -p <port>`.
- Ensure you pass a custom port if you want to run multiple instances concurrently.

### 2. Migration Failures
If migrations fail, check if the Docker database container is running.
- Run `docker ps` to verify that `rmc_db` is running.
- If it is not running, run `docker-compose up -d` before retrying.
