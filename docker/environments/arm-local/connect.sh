#!/bin/bash

# This script connects to the running test container and optionally sets up the test environment

# Parse command line arguments
CI_MODE=false
CI_BRANCH=""
while [ $# -gt 0 ]; do
  case $1 in
    -h|--help)
      echo "Usage: ./connect.sh [OPTIONS]"
      echo ""
      echo "Connects to the running test container and sets up the Positron test environment"
      echo ""
      echo "OPTIONS:"
      echo "  --ci <branch>  CI mode: skip prompts and setup specified branch automatically"
      echo "  -h, --help     Show this help message"
      exit 0
      ;;
    --ci)
      CI_MODE=true
      shift
      if [ -n "$1" ] && [ "${1:0:1}" != "-" ]; then
        CI_BRANCH="$1"
        shift
      else
        echo "Error: --ci requires a branch name"
        echo "Usage: ./connect.sh --ci <branch_name>"
        exit 1
      fi
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Load environment variables from .env file if it exists
# Only KEY=VALUE lines are processed to avoid executing arbitrary shell code
if [ -f .env ]; then
  echo "Loading environment variables from .env file..."
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments and blank lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    # Only accept lines of the form KEY=VALUE (no shell metacharacters in key)
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*=(.*)$ ]]; then
      export "$line"
    fi
  done < .env
fi

# Check if the container is running
if ! docker ps | grep -q "test"; then
  echo "Error: test container is not running!"
  echo "Start with: npm run arm:start"
  exit 1
fi

# Copy scripts to container (quietly)
for script in setup-test-env.sh start-vnc.sh ssh-install.sh; do
  if [ -f "./$script" ]; then
    docker cp "./$script" "test:/tmp/$script" >/dev/null 2>&1
    docker exec test chmod +x "/tmp/$script" 2>/dev/null
  fi
done

# Connect to the container and run setup
if [ "$CI_MODE" = true ]; then
  echo "Running in CI mode with branch: $CI_BRANCH"
  docker exec -it test /bin/bash -c "/tmp/setup-test-env.sh '$CI_BRANCH' && exec /bin/bash -l"
else
  # Interactive mode - show status and menu
  docker exec -it test /bin/bash -c '
    # Check setup status
    if [ -d "/__w/positron/positron/.git" ]; then
        BRANCH=$(cd /__w/positron/positron && git branch --show-current 2>/dev/null)
        COMMIT=$(cd /__w/positron/positron && git log -1 --format="%h %s" 2>/dev/null)
        SETUP_DONE=true
    else
        SETUP_DONE=false
    fi

    # Ensure Xvfb is running (required for electron tests)
    if ! pgrep -x Xvfb >/dev/null 2>&1; then
        /usr/bin/Xvfb :10 -ac -screen 0 2560x1440x24 > /tmp/Xvfb.out 2>&1 &
        sleep 1
    fi
    export DISPLAY=:10

    # Check Xvfb
    if pgrep -x Xvfb >/dev/null 2>&1; then
        DISPLAY_STATUS="running"
    else
        DISPLAY_STATUS="not running"
    fi

    # Check e2e server
    if ss -tlnp 2>/dev/null | grep -q ":8080" || netstat -tlnp 2>/dev/null | grep -q ":8080"; then
        SERVER_STATUS="running  → http://localhost:8080/?tkn=dev-token"
    else
        SERVER_STATUS="not running"
    fi

    echo ""
    echo "=== Status ==="
    if [ "$SETUP_DONE" = true ]; then
        echo "Branch:  $BRANCH"
        echo "Commit:  $COMMIT"
        echo "Display: $DISPLAY_STATUS"
        echo "Server:  $SERVER_STATUS"
    else
        echo "Setup:   Not complete"
        echo "Display: $DISPLAY_STATUS"
    fi

    echo ""
    echo "=== Options ==="
    if [ "$SETUP_DONE" = true ]; then
        echo "1) Update environment   [git pull + reinstall]"
        echo "2) Skip to shell"
        echo ""
        read -p "Choice [1-2, default=2]: " choice
        choice=${choice:-2}
    else
        echo "1) Setup environment   [clone + install]"
        echo "2) Skip to shell"
        echo ""
        read -p "Choice [1-2, default=1]: " choice
        choice=${choice:-1}
    fi

    case $choice in
      1)
        echo ""
        read -p "Branch [default=main]: " branch
        branch=${branch:-main}
        /tmp/setup-test-env.sh "$branch"
        ;;
      2)
        ;;
      *)
        echo "Invalid choice."
        ;;
    esac

    # Always show quick reference before dropping to shell
    echo ""
    if [ -d "/__w/positron/positron/.git" ]; then
        echo "=== Quick Reference ==="
        echo "Test commands:"
        echo "  run-tests --project e2e-electron --workers 2 --grep @:connections"
        echo "  run-tests --project e2e-server   --workers 2 --grep @:web"
        echo ""
        echo "Other commands:"
        echo "  start-server   - Start e2e server on :8080"
        echo "  start-vnc      - Watch tests run visually (connect to localhost:5900)"
        echo "  show-report    - Serve test report at http://localhost:9323"
        echo "  install-ssh    - Install SSH server (for Remote SSH editor access)"
        echo "  status         - Reprint branch, display, and server status"
        echo "  commands       - Reprint this list"
        echo ""
        echo "Logs:"
        echo "  tail /tmp/e2e-server.log  - e2e server logs"
        echo "  tail /tmp/Xvfb.out        - display server logs"
        echo ""
        cd /__w/positron/positron
    else
        echo "=== Quick Reference ==="
        echo "To set up, run:"
        echo "  /tmp/setup-test-env.sh <branch>"
        echo ""
        echo "Other commands:"
        echo "  /tmp/start-vnc.sh    - Start VNC server"
        echo "  /tmp/ssh-install.sh  - Install SSH server"
        echo ""
    fi
    exec /bin/bash -l
  '
fi
