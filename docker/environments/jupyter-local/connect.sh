#!/bin/sh

# Prevent MINGW/Git Bash from converting Unix paths to Windows paths
export MSYS_NO_PATHCONV=1

# This script connects to the running jupyter-test container

# Parse command line arguments
CI_MODE=false
while [ $# -gt 0 ]; do
  case $1 in
    -h|--help)
      echo "Usage: ./connect.sh [OPTIONS]"
      echo ""
      echo "Connects to the running jupyter-test container with an interactive bash shell"
      echo ""
      echo "OPTIONS:"
      echo "  --ci        CI mode: skip all prompts and use defaults (requires GITHUB_TOKEN env var)"
      echo "  -h, --help  Show this help message"
      exit 0
      ;;
    --ci)
      CI_MODE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

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
if ! docker ps | grep -q "jupyter-test"; then
  echo "Error: jupyter-test container is not running!"
  echo "Start with: ./run.sh"
  exit 1
fi

# Create scripts directory in container
docker exec jupyter-test mkdir -p /opt/scripts >/dev/null 2>&1

# Copy scripts to container (quietly), stripping Windows line endings
for script in install-jupyter-positron.sh positronDownload.sh; do
  if [ -f "./$script" ]; then
    docker cp "./$script" "jupyter-test:/opt/scripts/$script" >/dev/null 2>&1
    docker exec jupyter-test sed -i 's/\r$//' "/opt/scripts/$script" 2>/dev/null
    docker exec jupyter-test chmod +x "/opt/scripts/$script" 2>/dev/null
  fi
done

# Copy license file to staging area if it exists (will be moved to final location by install script)
if [ -f "./positron.lic" ]; then
  echo "Copying license file to container staging area..."
  if docker cp "./positron.lic" "jupyter-test:/opt/positron.lic"; then
    echo "  ✓ License file staged at /opt/positron.lic"
  else
    echo "  ✗ Failed to copy license file to staging area"
  fi
fi

# Show current status
echo ""
echo "=== Status ==="
JUPYTER_STATUS=$(docker exec jupyter-test bash -c 'systemctl is-active jupyterhub 2>/dev/null || echo "not installed"' 2>/dev/null)
if [ "$JUPYTER_STATUS" = "active" ]; then
    echo "JupyterHub:  Running"
    POSITRON_VERSION=$(docker exec jupyter-test bash -c '
        if [ -f "/opt/positron-server/product.json" ]; then
            VER=$(grep "positronVersion" "/opt/positron-server/product.json" 2>/dev/null | sed "s/.*\"positronVersion\": *\"\([^\"]*\)\".*/\1/")
            BUILD=$(grep "positronBuildNumber" "/opt/positron-server/product.json" 2>/dev/null | sed "s/.*\"positronBuildNumber\": *\"\([^\"]*\)\".*/\1/")
            echo "${VER}-${BUILD}"
        fi
    ' 2>/dev/null)
    if [ -n "$POSITRON_VERSION" ] && [ "$POSITRON_VERSION" != "-" ]; then
        echo "Positron:    $POSITRON_VERSION"
    fi
    ALREADY_INSTALLED=true
elif [ "$JUPYTER_STATUS" = "not installed" ]; then
    echo "JupyterHub:  Not installed"
    ALREADY_INSTALLED=false
else
    echo "JupyterHub:  Inactive"
    ALREADY_INSTALLED=true
fi
echo ""

# Connect to the container and run install script
if [ "$CI_MODE" = true ]; then
  echo "Running in CI mode - using latest versions without prompts..."
  docker exec -it -e GITHUB_TOKEN="$GITHUB_TOKEN" jupyter-test /bin/bash -c "/opt/scripts/install-jupyter-positron.sh --ci; exec /bin/bash"
else
  docker exec -it -e GITHUB_TOKEN="$GITHUB_TOKEN" -e ALREADY_INSTALLED="$ALREADY_INSTALLED" jupyter-test /bin/bash -c '
    /opt/scripts/install-jupyter-positron.sh

    # Show quick reference before dropping to shell
    echo ""
    echo "=== Quick Reference ==="
    if systemctl is-active jupyterhub >/dev/null 2>&1; then
        echo "Access JupyterHub: http://localhost:8888"
        echo "  Username: admin"
        echo "  Password: Set on first login"
        echo ""
        echo "  Or use your configured user:"
        echo "  Username: user (or Q_USER from .env)"
        echo "  Password: Set on first login"
        echo ""
    else
        echo "To install, run:"
        echo "  /opt/scripts/install-jupyter-positron.sh"
    fi
    echo ""
    exec /bin/bash
  '
fi
