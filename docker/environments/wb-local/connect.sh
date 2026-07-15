#!/bin/sh

# Prevent MINGW/Git Bash from converting Unix paths to Windows paths
export MSYS_NO_PATHCONV=1

# This script connects to the running test container

# Parse command line arguments
CI_MODE=false
CI_STABLE_MODE=false
CREDENTIALS=""
while [ $# -gt 0 ]; do
  case $1 in
    -h|--help)
      echo "Usage: ./connect.sh [OPTIONS]"
      echo ""
      echo "Connects to the running test container with an interactive bash shell"
      echo ""
      echo "OPTIONS:"
      echo "  --ci                      CI mode: skip all prompts and use latest versions (requires GITHUB_TOKEN env var)"
      echo "  --ci-stable               CI mode: skip all prompts, latest Positron + released Workbench (requires GITHUB_TOKEN env var)"
      echo "  --credentials=<type>      Configure one credential type: databricks, snowflake, or azure"
      echo "  -h, --help                Show this help message"
      exit 0
      ;;
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
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Validate credential type if provided
if [ -n "$CREDENTIALS" ]; then
  case "$CREDENTIALS" in
    databricks|snowflake|azure) ;;
    *)
      echo "Invalid --credentials value: '$CREDENTIALS' (expected: databricks, snowflake, or azure)"
      exit 1
      ;;
  esac
  echo "Credential type selected: $CREDENTIALS"
else
  echo "No --credentials specified - no data source will be configured"
fi

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  echo "Loading environment variables from .env file..."
  export $(grep -v '^#' .env | xargs)
fi

# GITHUB_TOKEN is always required
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: set GITHUB_TOKEN before running: GITHUB_TOKEN=your_token ./connect.sh"
  exit 1
fi

# Check if the container is running
if ! docker ps | grep -q "test"; then
  echo "Error: test container is not running!"
  echo "Start with: npm run wb:start"
  exit 1
fi

# Copy scripts to container (quietly), stripping Windows line endings
for script in install-workbench.sh ensure-connect-token.sh positronDownload.sh get-latest-wb-noble-url.sh configure-datasources.sh; do
  if [ -f "./$script" ]; then
    docker cp "./$script" "test:/tmp/$script" >/dev/null 2>&1
    docker exec test sed -i 's/\r$//' "/tmp/$script" 2>/dev/null
    docker exec test chmod +x "/tmp/$script" 2>/dev/null
  fi
done

# Copy license file if present
if [ -f "./workbench.lic" ]; then
  docker cp "./workbench.lic" "test:/tmp/workbench.lic" >/dev/null 2>&1
fi

# Show current status
echo ""
echo "=== Status ==="
WB_VERSION=$(docker exec test bash -c 'rstudio-server version 2>/dev/null | head -1 | awk "{print \$1}"' 2>/dev/null)
if [ -n "$WB_VERSION" ] && [ "$WB_VERSION" != "" ]; then
    echo "Workbench: $WB_VERSION"
    POSITRON_VERSION=$(docker exec test bash -c '
        for dir in /usr/lib/rstudio-server/bin/positron-server/new /usr/lib/rstudio-server/bin/positron-server; do
            if [ -f "$dir/product.json" ]; then
                VER=$(grep "positronVersion" "$dir/product.json" 2>/dev/null | sed "s/.*\"positronVersion\": *\"\([^\"]*\)\".*/\1/")
                BUILD=$(grep "positronBuildNumber" "$dir/product.json" 2>/dev/null | sed "s/.*\"positronBuildNumber\": *\"\([^\"]*\)\".*/\1/")
                echo "${VER}-${BUILD}"
                exit 0
            fi
        done
    ' 2>/dev/null)
    if [ -n "$POSITRON_VERSION" ] && [ "$POSITRON_VERSION" != "-" ]; then
        echo "Positron:  $POSITRON_VERSION"
    fi
    ALREADY_INSTALLED=true
else
    echo "Workbench: Not installed"
    ALREADY_INSTALLED=false
fi
echo ""

# Connect to the container and run install script
if [ "$CI_MODE" = true ] || [ "$CI_STABLE_MODE" = true ]; then
  if [ "$CI_STABLE_MODE" = true ]; then
    CI_INSTALL_FLAG="--ci-stable"
    echo "Running in CI stable mode - latest Positron + released Workbench without prompts..."
  else
    CI_INSTALL_FLAG="--ci"
    echo "Running in CI mode - using latest versions without prompts..."
  fi
  docker exec -it \
    -e GITHUB_TOKEN="$GITHUB_TOKEN" \
    -e DATABRICKS_URL_="${DATABRICKS_URL:-}" \
    -e DATABRICKS_CLIENT_ID_="${DATABRICKS_CLIENT_ID:-}" \
    -e IDE_SERVICE_ACCOUNT_EMAIL_="${IDE_SERVICE_ACCOUNT_EMAIL:-}" \
    -e IDE_SERVICE_ACCOUNT_PASSWORD_="${IDE_SERVICE_ACCOUNT_PASSWORD:-}" \
    -e IDE_SERVICE_ACCOUNT_OTP_SECRET_="${IDE_SERVICE_ACCOUNT_OTP_SECRET:-}" \
    -e SNOWFLAKE_ACCOUNT_="${SNOWFLAKE_ACCOUNT:-}" \
    -e SNOWFLAKE_CLIENT_ID_="${SNOWFLAKE_CLIENT_ID:-}" \
    -e SNOWFLAKE_CLIENT_SECRET_="${SNOWFLAKE_CLIENT_SECRET:-}" \
    -e SNOWFLAKE_USERNAME_="${SNOWFLAKE_USERNAME:-}" \
    -e SNOWFLAKE_PASSWORD_="${SNOWFLAKE_PASSWORD:-}" \
    -e AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET_="${AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET:-}" \
    test /bin/bash -c "/tmp/install-workbench.sh $CI_INSTALL_FLAG ${CREDENTIALS:+--credentials=$CREDENTIALS}; exec /bin/bash"
else
  docker exec -it \
    -e GITHUB_TOKEN="$GITHUB_TOKEN" \
    -e ALREADY_INSTALLED="$ALREADY_INSTALLED" \
    -e DATABRICKS_URL_="${DATABRICKS_URL:-}" \
    -e DATABRICKS_CLIENT_ID_="${DATABRICKS_CLIENT_ID:-}" \
    -e IDE_SERVICE_ACCOUNT_EMAIL_="${IDE_SERVICE_ACCOUNT_EMAIL:-}" \
    -e IDE_SERVICE_ACCOUNT_PASSWORD_="${IDE_SERVICE_ACCOUNT_PASSWORD:-}" \
    -e IDE_SERVICE_ACCOUNT_OTP_SECRET_="${IDE_SERVICE_ACCOUNT_OTP_SECRET:-}" \
    -e SNOWFLAKE_ACCOUNT_="${SNOWFLAKE_ACCOUNT:-}" \
    -e SNOWFLAKE_CLIENT_ID_="${SNOWFLAKE_CLIENT_ID:-}" \
    -e SNOWFLAKE_CLIENT_SECRET_="${SNOWFLAKE_CLIENT_SECRET:-}" \
    -e SNOWFLAKE_USERNAME_="${SNOWFLAKE_USERNAME:-}" \
    -e SNOWFLAKE_PASSWORD_="${SNOWFLAKE_PASSWORD:-}" \
    -e AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET_="${AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET:-}" \
    -e CREDENTIALS="${CREDENTIALS:-}" \
    test /bin/bash -c '
    /tmp/install-workbench.sh ${CREDENTIALS:+--credentials="$CREDENTIALS"}

    # Show quick reference before dropping to shell
    echo ""
    echo "=== Quick Reference ==="
    if rstudio-server status >/dev/null 2>&1; then
        echo "Access Workbench: http://localhost:8787"
        echo "  Username: user1"
        echo "  Password: (your WB_PASSWORD from .env)"
        echo ""
        echo "Access Connect:   http://localhost:3939"
    else
        echo "To install, run:"
        echo "  /tmp/install-workbench.sh"
    fi
    echo ""
    exec /bin/bash
  '
fi
