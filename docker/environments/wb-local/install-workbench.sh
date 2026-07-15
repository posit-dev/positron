#!/bin/bash

# Initialize error tracking
ERRORS=()

# Function to log errors
log_error() {
    ERRORS+=("$1")
    echo "❌ ERROR: $1"
}

# Parse command line arguments
CI_MODE=false
CI_STABLE_MODE=false
CREDENTIALS=""
while [ $# -gt 0 ]; do
  case $1 in
    --ci)
      CI_MODE=true
      shift
      ;;
    --ci-stable)
      CI_STABLE_MODE=true
      shift
      ;;
    --credentials=*)
      CREDENTIALS="${1#*=}"
      shift
      ;;
    --credentials)
      CREDENTIALS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate credential type if provided
if [ -n "${CREDENTIALS}" ]; then
    case "${CREDENTIALS}" in
        databricks|snowflake|azure) ;;
        *)
            echo "Invalid --credentials value: '${CREDENTIALS}' (expected: databricks, snowflake, or azure)"
            exit 1
            ;;
    esac
fi

# Interactive installation prompt (skip in CI mode)
if [ "$CI_MODE" = true ]; then
    echo ""
    echo "CI Mode: Installing latest versions..."
    echo "======================================"
elif [ "$CI_STABLE_MODE" = true ]; then
    echo ""
    echo "CI Stable Mode: Installing latest Positron + released Workbench..."
    echo "======================================================================"
elif [ -z "${WB_URL}" ] && [ -z "${POSITRON_TAG}" ]; then
    echo ""
    echo "Workbench + Positron Installation"
    echo "---------------------------------"
    if [ "$ALREADY_INSTALLED" = "true" ]; then
        echo "1) Update to latest versions"
        echo "2) Specific versions"
        echo "3) Skip to shell           [recommended - already installed]"
        DEFAULT_CHOICE=3
    else
        echo "1) Latest versions         [recommended]"
        echo "2) Specific versions"
        echo "3) Skip to shell"
        DEFAULT_CHOICE=1
    fi
    echo ""
    read -p "Enter your choice [1-3, default = $DEFAULT_CHOICE]: " choice

    case ${choice:-$DEFAULT_CHOICE} in
        1)
            if [ "$ALREADY_INSTALLED" = "true" ]; then
                echo "Updating to latest versions..."
            else
                echo "Installing latest versions..."
            fi
            ;;
        2)
            echo ""
            echo "Enter specific versions (or press Enter for defaults):"
            read -p "Workbench URL [press Enter for latest]: " user_wb_url
            read -p "Positron tag (e.g., 2025.10.0-88) [press Enter for latest]: " user_positron_tag

            if [ -n "$user_wb_url" ]; then
                export WB_URL="$user_wb_url"
            fi
            if [ -n "$user_positron_tag" ]; then
                export POSITRON_TAG="$user_positron_tag"
            fi
            ;;
        3)
            echo "Skipping installation. Going to shell..."
            exec /bin/bash
            ;;
        *)
            echo "Invalid choice. Using latest versions..."
            ;;
    esac
    echo ""
fi

# Function to fetch the latest Workbench URL based on architecture
fetch_latest_wb_url() {
    local arch=$1
    local json_url="https://dailies.rstudio.com/rstudio/latest/index.json"
    
    # Map architecture to the correct key in the json
    local platform_key
    if [ "$arch" = "arm64" ]; then
        platform_key="noble-arm64"
    else
        platform_key="noble-amd64"
    fi
    
    # Fetch the json and extract the URL
    local url
    url=$(curl -s "$json_url" | jq -r ".products.workbench.platforms[\"$platform_key\"].link")
    
    if [ -z "$url" ] || [ "$url" = "null" ]; then
        echo "Failed to fetch the latest Workbench URL for $arch architecture" >&2
        return 1
    fi
    
    echo "$url"
}

# ensure_connect_token is defined in ensure-connect-token.sh (copied alongside
# this script into /tmp). Sourcing it here keeps the Workbench flow and the
# standalone connect-local bootstrap using the exact same logic.
source "$(dirname "${BASH_SOURCE[0]}")/ensure-connect-token.sh"

# Initial parameter setup - auto-detect architecture if not set
if [ -z "${ARCH_SUFFIX:-}" ]; then
  case "$(uname -m)" in
    aarch64|arm64) ARCH_SUFFIX="arm64" ;;
    x86_64|amd64)  ARCH_SUFFIX="amd64" ;;
    *)             ARCH_SUFFIX="arm64" ;;
  esac
fi
POSITRON_TAG=${POSITRON_TAG:-""}  # Empty default will get the latest release
GITHUB_TOKEN=${GITHUB_TOKEN:-"myToken"}

# User configuration with defaults that can be overridden by environment variables
Q_USER=${Q_USER:-"user1"}
Q_UID=${Q_UID:-1100}
Q_GID=${Q_GID:-1100}
Q_GROUP=${Q_GROUP:-"user1g"}
WB_PASSWORD=${WB_PASSWORD:-"testpassword"}

# Install required packages early so we have jq for URL fetching
echo "Installing required packages..."
if ! sudo apt-get update; then
    log_error "Failed to update package lists"
fi
if ! sudo add-apt-repository -y universe; then
    log_error "Failed to add universe repository"
fi
if ! sudo apt-get update; then
    log_error "Failed to update package lists after adding universe"
fi
if ! sudo apt-get install -y acl jq curl; then
    log_error "Failed to install required packages (acl, jq, curl)"
fi

# Now we can fetch the WB_URL if it wasn't provided
if [ -z "${WB_URL}" ]; then
    if [ "$CI_STABLE_MODE" = true ]; then
        echo "CI Stable Mode: Fetching latest released Workbench URL for ${ARCH_SUFFIX} architecture..."
        # Get the directory where this script is located
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        WB_URL=$("${SCRIPT_DIR}/get-latest-wb-noble-url.sh" "${ARCH_SUFFIX}")
        if [ $? -ne 0 ] || [ -z "${WB_URL}" ]; then
            log_error "Failed to fetch released Workbench URL from get-latest-wb-noble-url.sh"
        fi
        echo "Using released Workbench URL: ${WB_URL}"
    else
        echo "No WB_URL provided, fetching latest Workbench URL for ${ARCH_SUFFIX} architecture..."
        WB_URL=$(fetch_latest_wb_url "${ARCH_SUFFIX}")
        if [ $? -ne 0 ]; then
            echo "Failed to fetch Workbench URL. Using fallback URL."
            WB_URL="https://s3.amazonaws.com/rstudio-ide-build/server/jammy/${ARCH_SUFFIX}/rstudio-workbench-2025.11.0-daily-131.pro5-${ARCH_SUFFIX}.deb"
        fi
        echo "Using Workbench URL: ${WB_URL}"
    fi
else
    echo "Using provided Workbench URL: ${WB_URL}"
fi

# Log the configuration being used (but don't show the password)
echo "Using configuration:"
echo "  WB_URL: ${WB_URL}"
if [ -n "${POSITRON_TAG}" ]; then
    echo "  POSITRON_TAG: ${POSITRON_TAG}"
else
    echo "  POSITRON_TAG: [LATEST]"
fi
echo "  ARCH_SUFFIX: ${ARCH_SUFFIX}"
echo "  Q_USER: ${Q_USER}"
echo "  Q_UID: ${Q_UID}"
echo "  Q_GID: ${Q_GID}"
echo "  Q_GROUP: ${Q_GROUP}"
echo "  WB_PASSWORD: [HIDDEN]"
if [ -n "${CREDENTIALS}" ]; then
    echo "  CREDENTIALS: ${CREDENTIALS}"
else
    echo "  CREDENTIALS: [none]"
fi

# Create the user (skip if already exists)
echo "Creating user ${Q_USER}..."
if ! getent group ${Q_GROUP} > /dev/null 2>&1; then
    sudo groupadd -g ${Q_GID} ${Q_GROUP}
else
    echo "  Group ${Q_GROUP} already exists, skipping..."
fi
if ! id -u ${Q_USER} > /dev/null 2>&1; then
    sudo useradd --create-home --shell /bin/bash --home-dir /home/${Q_USER} -u ${Q_UID} -g ${Q_GROUP} ${Q_USER}
else
    echo "  User ${Q_USER} already exists, skipping..."
fi
echo "${Q_USER}":"${WB_PASSWORD}" | sudo chpasswd

echo "Configuring ~/.Renviron for ${Q_USER}..."
sudo mkdir -p "/home/${Q_USER}"
sudo tee "/home/${Q_USER}/.Renviron" >/dev/null <<EOF
R_LIBS_SITE=/usr/local/lib/R/site-library
R_LIBS_USER=/usr/local/lib/R/site-library
EOF
sudo chown "${Q_USER}:${Q_GROUP}" "/home/${Q_USER}/.Renviron"

# Configure RStudio
echo "Configuring RStudio..."
sudo mkdir -p /etc/rstudio
echo "unprivileged=1" | sudo tee /etc/rstudio/launcher.local.conf > /dev/null

# Download Workbench
echo "Downloading Workbench..."
if ! curl ${WB_URL} --output workbench.deb; then
    log_error "Failed to download Workbench from ${WB_URL}"
fi

# Install Workbench
echo "Installing Workbench..."
if ! sudo apt install -y ./workbench.deb; then
    log_error "Failed to install Workbench package"
fi

# Copy and configure Workbench license if present
if [ -f "/tmp/workbench.lic" ]; then
    echo "Configuring Workbench license..."
    sudo mkdir -p /var/lib/rstudio-server
    sudo cp /tmp/workbench.lic /var/lib/rstudio-server/workbench.lic
    sudo chown 999:999 /var/lib/rstudio-server/workbench.lic
    sudo chmod 0600 /var/lib/rstudio-server/workbench.lic
    echo "Workbench license configured"
else
    echo "No Workbench license file found at /tmp/workbench.lic - skipping license configuration"
fi

# Set access permissions
echo "Setting access permissions..."
sudo setfacl -m u:${Q_USER}:x /root
sudo setfacl -R -m u:${Q_USER}:rx /root/.venv /root/.pyenv
sudo setfacl -R -m d:u:${Q_USER}:rx /root/.venv /root/.pyenv

# Update positron-server
echo "Updating positron-server..."
if ! sudo rstudio-server stop; then
    log_error "Failed to stop RStudio server"
fi

# rstudio-server stop can return before rserver has fully exited, and this
# container has no systemd to wait on. Wait for rserver to actually exit so we
# don't mutate its install dir while it's still running.
echo "Waiting for rserver to stop..."
for _ in $(seq 1 15); do
    pgrep -x rserver >/dev/null 2>&1 || break
    sleep 1
done

# Safety net: if rserver is still alive, signal it.
if pgrep -x rserver >/dev/null 2>&1; then
    echo "rserver still running - sending TERM..."
    sudo pkill -x rserver 2>/dev/null || true
fi

cd /usr/lib/rstudio-server/bin/

# Check if positron-server/bundled exists
if [ -d "positron-server/bundled" ]; then
    echo "Found positron-server/bundled directory - extracting to positron-server/new..."

    # Remove existing new directory if it exists
    if [ -d "positron-server/new" ]; then
        echo "Removing existing positron-server/new directory..."
        sudo rm -rf positron-server/new
    fi

    # Create the new directory
    if ! sudo mkdir -p positron-server/new; then
        log_error "Failed to create positron-server/new directory"
    fi

    cd positron-server/new
else
    echo "No bundled directory found - using legacy extraction method..."

    # Clean up any existing backup and move current version
    if [ -d "positron-server-old" ]; then
        echo "Removing existing positron-server-old backup..."
        sudo rm -rf positron-server-old
    fi

    if [ -d "positron-server" ]; then
        if ! sudo mv positron-server positron-server-old; then
            log_error "Failed to backup existing positron-server"
        fi
    fi

    if ! sudo mkdir -p positron-server; then
        log_error "Failed to create new positron-server directory"
    fi

    cd positron-server
fi

# Run download script
if [ -n "${POSITRON_TAG}" ]; then
    echo "Running download script with TAG=${POSITRON_TAG}, ARCH_SUFFIX=${ARCH_SUFFIX}, GITHUB_TOKEN=***..."
else
    echo "Running download script with latest Positron release, ARCH_SUFFIX=${ARCH_SUFFIX}, GITHUB_TOKEN=***..."
fi
if ! TAG=${POSITRON_TAG} ARCH_SUFFIX=${ARCH_SUFFIX} GITHUB_TOKEN=${GITHUB_TOKEN} /tmp/positronDownload.sh; then
    log_error "Failed to download/install Positron"
fi

# Configure data sources (one credential type: databricks, snowflake, or azure)
if [ -n "${CREDENTIALS}" ]; then
    echo "Configuring data source: ${CREDENTIALS}..."
    if [ -f "/tmp/configure-datasources.sh" ]; then
        if ! /tmp/configure-datasources.sh "${CREDENTIALS}"; then
            log_error "Failed to configure data source: ${CREDENTIALS}"
        fi
    else
        echo "Skipping data source configuration (configure-datasources.sh not found)"
    fi
else
    echo "No --credentials specified - skipping data source configuration"
fi

# Start RStudio server
echo "Starting RStudio server..."
if ! sudo rstudio-server start; then
    log_error "Failed to start RStudio server"
fi

# Ensure (fetch once) + export CONNECT_TOKEN for subsequent steps/tests
ensure_connect_token || true

# Setup environment modules
echo "Setting up environment modules..."
if ! sudo apt install -y environment-modules; then
    log_error "Failed to install environment-modules"
fi
if ! sudo mkdir -p /opt/modules/modulefiles/R; then
    log_error "Failed to create /opt/modules/modulefiles/R directory"
fi
printf '#%%Module1.0\nset root /root/scratch/R-4.4.1\nprepend-path PATH $root/bin\nprepend-path MANPATH $root/share/man\nsetenv R_HOME $root/lib/R\n' | sudo tee /opt/modules/modulefiles/R/4.4.1 > /dev/null
if ! sudo mkdir -p /opt/modules/modulefiles/python; then
    log_error "Failed to create /opt/modules/modulefiles/python directory"
fi
printf '#%%Module1.0\nset root /root/scratch/python-env\nprepend-path PATH $root/bin\n' | sudo tee /opt/modules/modulefiles/python/3.12.10 > /dev/null
echo 'source /etc/profile.d/modules.sh' >> /home/${Q_USER}/.profile
echo 'module use /opt/modules/modulefiles' >> /home/${Q_USER}/.profile

# Log completion and versions
echo ""
echo "Installation complete 🎉"

# Extract Workbench version - just get the first word from "2025.11.0-daily+151.pro2 Workbench..."
WB_VERSION=$(sudo rstudio-server version 2>/dev/null | head -1 | awk '{print $1}')

# Extract Positron version and build number, combine them
# Check if we extracted to the 'new' directory (when bundled exists) or directly to positron-server
if [ -d "/usr/lib/rstudio-server/bin/positron-server/new" ]; then
    POSITRON_DIR="/usr/lib/rstudio-server/bin/positron-server/new"
else
    POSITRON_DIR="/usr/lib/rstudio-server/bin/positron-server"
fi

POSITRON_VERSION=$(cd "${POSITRON_DIR}" && grep '"positronVersion"' product.json 2>/dev/null | sed 's/.*"positronVersion": *"\([^"]*\)".*/\1/' || echo "Unknown")
POSITRON_BUILD=$(cd "${POSITRON_DIR}" && grep '"positronBuildNumber"' product.json 2>/dev/null | sed 's/.*"positronBuildNumber": *"\([^"]*\)".*/\1/' || echo "")
POSITRON_FULL_VERSION="${POSITRON_VERSION}-${POSITRON_BUILD}"

echo "Positron version:    ${POSITRON_FULL_VERSION}"
echo "Workbench version:   ${WB_VERSION}"
echo "Workbench URL:       http://localhost:8787"

# Report any errors that occurred
if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  WARNING: ${#ERRORS[@]} error(s) occurred during installation:"
    for error in "${ERRORS[@]}"; do
        echo "   • $error"
    done
    echo ""
    echo "Installation may not be fully functional. Check logs above for details."
fi
echo ""
