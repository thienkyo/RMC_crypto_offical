#!/bin/bash

# ==============================================================================
# updateCode.sh
# Deployment and Restart Automation Script for RMC Crypto
# ==============================================================================

# Exit immediately if a command exits with a non-zero status
set -e

# Configurable defaults
DEFAULT_PORT_DEV=7070
DEFAULT_PORT_PROD=3000
PM2_APP_NAME="rmc-crypto"
ENV_FILE=".env.local"
PID_FILE=".app.pid"

# Color Codes for Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions for logging
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Print usage help
print_usage() {
    echo "Usage: ./updateCode.sh [options]"
    echo ""
    echo "Options:"
    echo "  -d, --dev            Run in development mode (default)"
    echo "  -p, --prod           Run in production mode"
    echo "  -f, --force          Force install, build, migrations, and restart even if no git changes"
    echo "  --port <port>        Override the application port"
    echo "  --pm2-name <name>    Override the PM2 application name"
    echo "  -h, --help           Show this help message"
    echo ""
}

# Parse command line arguments
MODE="dev"
FORCE=false
PORT_OVERRIDE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dev)
            MODE="dev"
            shift
            ;;
        -p|--prod)
            MODE="prod"
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        --port)
            PORT_OVERRIDE="$2"
            shift 2
            ;;
        --pm2-name)
            PM2_APP_NAME="$2"
            shift 2
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1\nUse -h or --help for usage instructions."
            ;;
    esac
done

# Ensure we are in a Git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log_error "This script must be run inside a Git repository."
fi

# Detect active port based on mode, env, or override
PORT=$PORT_OVERRIDE
if [ -z "$PORT" ]; then
    if [ -f "$ENV_FILE" ]; then
        # Try to extract PORT variable from .env.local
        PORT=$(grep -E "^PORT=" "$ENV_FILE" | cut -d'=' -f2)
    fi
    # If still empty, use defaults
    if [ -z "$PORT" ]; then
        if [ "$MODE" = "prod" ]; then
            PORT=$DEFAULT_PORT_PROD
        else
            PORT=$DEFAULT_PORT_DEV
        fi
    fi
fi

log_info "Configuration loaded:"
log_info "  Mode: $MODE"
log_info "  Port: $PORT"
log_info "  PM2 App Name: $PM2_APP_NAME"
log_info "  Force updates: $FORCE"

# Detect package manager
PACKAGE_MANAGER="npm"
if [ -f "pnpm-lock.yaml" ]; then
    PACKAGE_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
    PACKAGE_MANAGER="yarn"
fi
log_info "Detected package manager: $PACKAGE_MANAGER"

# Fetch latest changes from remote
log_info "Fetching latest changes from remote repository..."
git fetch origin

# Compare local branch with remote tracking branch
CURRENT_BRANCH=$(git branch --show-current)
UPSTREAM="origin/$CURRENT_BRANCH"

if ! git rev-parse --verify "$UPSTREAM" >/dev/null 2>&1; then
    log_warn "No remote upstream tracking branch found for '$CURRENT_BRANCH'."
    UPSTREAM="origin/main"
    log_info "Defaulting comparison to '$UPSTREAM'"
fi

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "$UPSTREAM")

NEED_INSTALL=false
NEED_MIGRATE=false
NEED_BUILD=false
NEED_RESTART=false

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    log_success "Local branch is up-to-date with remote ($UPSTREAM)."
    if [ "$FORCE" = true ]; then
        log_warn "Force flag set. Running full checks and restart anyway..."
        NEED_INSTALL=true
        NEED_MIGRATE=true
        NEED_BUILD=true
        NEED_RESTART=true
    else
        log_info "No changes detected. Nothing to do."
        exit 0
    fi
else
    # We are behind remote, need to pull
    log_info "Local branch is behind remote. Pulling changes..."
    
    # Store list of files that will change
    CHANGED_FILES=$(git diff --name-only HEAD "$UPSTREAM")
    
    # Run the pull
    git pull
    log_success "Successfully pulled latest code."
    
    NEED_RESTART=true
    
    # Check what files changed to determine necessary tasks
    if echo "$CHANGED_FILES" | grep -qE "package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock"; then
        NEED_INSTALL=true
        # Dependencies changed, we should rebuild to be safe
        NEED_BUILD=true
    fi
    
    if echo "$CHANGED_FILES" | grep -qE "src/lib/db/.*schema\.sql|src/lib/db/.*migrate\.ts"; then
        NEED_MIGRATE=true
    fi
    
    if echo "$CHANGED_FILES" | grep -qE "\.(ts|tsx|js|jsx)$|next\.config|tsconfig|tailwind\.config"; then
        NEED_BUILD=true
    fi
fi

# Run NPM install if dependencies changed
if [ "$NEED_INSTALL" = true ]; then
    log_info "Dependencies changed. Running $PACKAGE_MANAGER install..."
    $PACKAGE_MANAGER install
    log_success "Dependencies installed."
else
    log_info "No dependency changes detected. Skipping install."
fi

# Run migrations if DB schema or migration scripts changed
if [ "$NEED_MIGRATE" = true ]; then
    log_info "Database schema changes detected. Running migrations..."
    if [ "$PACKAGE_MANAGER" = "npm" ]; then
        npm run migrate
    else
        $PACKAGE_MANAGER run migrate
    fi
    log_success "Migrations executed."
else
    log_info "No migration changes detected. Skipping migrations."
fi

# Run Build if code changed and we are in production mode
if [ "$MODE" = "prod" ]; then
    if [ "$NEED_BUILD" = true ]; then
        log_info "Source files changed. Building Next.js application..."
        if [ "$PACKAGE_MANAGER" = "npm" ]; then
            npm run build
        else
            $PACKAGE_MANAGER run build
        fi
        log_success "Application built successfully."
    else
        log_info "No code changes requiring rebuild. Skipping build."
    fi
fi

# Restarting the project
if [ "$NEED_RESTART" = true ] || [ "$FORCE" = true ]; then
    log_info "Restarting the project..."
    
    # Check for PM2 first
    if command -v pm2 >/dev/null 2>&1; then
        # Check if the app is already registered in PM2
        if pm2 list | grep -q "$PM2_APP_NAME"; then
            log_info "PM2 app '$PM2_APP_NAME' is active. Restarting via PM2..."
            pm2 restart "$PM2_APP_NAME"
            log_success "Project restarted via PM2."
            exit 0
        else
            log_warn "PM2 is installed but app '$PM2_APP_NAME' is not active."
        fi
    fi
    
    # Fallback to Port-based / PID restart
    log_info "Checking for process occupying port $PORT..."
    EXISTING_PID=$(lsof -t -i :"$PORT" 2>/dev/null || true)
    
    # Also check our PID file if it exists and process is running
    if [ -f "$PID_FILE" ]; then
        PID_FROM_FILE=$(cat "$PID_FILE")
        if kill -0 "$PID_FROM_FILE" 2>/dev/null; then
            if [ -z "$EXISTING_PID" ] || [ "$EXISTING_PID" != "$PID_FROM_FILE" ]; then
                log_info "Found running PID $PID_FROM_FILE from $PID_FILE. Adding to kill list."
                EXISTING_PID="$EXISTING_PID $PID_FROM_FILE"
            fi
        fi
    fi
    
    if [ -n "$EXISTING_PID" ]; then
        for PID in $EXISTING_PID; do
            log_warn "Stopping active process on PID $PID..."
            kill -15 "$PID" 2>/dev/null || true
            sleep 2
            if kill -0 "$PID" 2>/dev/null; then
                log_warn "Process $PID did not stop. Force killing..."
                kill -9 "$PID" 2>/dev/null || true
            fi
        done
        log_success "Terminated old processes."
    else
        log_info "No existing processes found running on port $PORT."
    fi
    
    # Start the app
    log_info "Starting project in $MODE mode on port $PORT..."
    if [ "$MODE" = "prod" ]; then
        # Run start command with port variable/argument
        PORT="$PORT" nohup $PACKAGE_MANAGER run start -- -p "$PORT" > prod.log 2>&1 &
    else
        # Run dev command
        # If the port is overridden (not default 7070), call next dev directly to avoid package.json override
        if [ "$PORT" != "7070" ]; then
            nohup npx next dev -p "$PORT" > dev.log 2>&1 &
        else
            nohup $PACKAGE_MANAGER run dev > dev.log 2>&1 &
        fi
    fi
    
    # Get the PID of the background job just started
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    
    # Verify if process is running
    sleep 2
    if kill -0 "$NEW_PID" 2>/dev/null; then
        log_success "Project started successfully! (PID: $NEW_PID)"
        log_info "Logs are being written to ${MODE}.log"
    else
        log_error "Project failed to start. Check ${MODE}.log for errors."
    fi
fi

exit 0
