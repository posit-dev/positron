#!/bin/sh

# Default to ubuntu24 if no OS argument is provided
OS_TYPE="ubuntu24"

# Check for OS type argument
if [ "$1" = "ubuntu24" ] || [ "$1" = "rocky8" ]; then
  OS_TYPE="$1"
fi

# Set docker-compose file based on OS type
COMPOSE_FILE="docker-compose.${OS_TYPE}.yml"

# Load other environment variables from .env file if it exists
if [ -f .env ]; then
  echo "Loading environment variables from .env file..."
  export $(grep -v '^#' .env | xargs)
fi

# Generate Connect bootstrap secret if not set
if [ -z "$CONNECT_BOOTSTRAP_SECRETKEY" ]; then
  export CONNECT_BOOTSTRAP_SECRETKEY=$(openssl rand -base64 32)
  echo "Generated CONNECT_BOOTSTRAP_SECRETKEY"
fi

# Auto-detect architecture if not already set
if [ -z "${ARCH_SUFFIX:-}" ]; then
  case "$(uname -m)" in
    aarch64|arm64) ARCH_SUFFIX="arm64" ;;
    x86_64|amd64)  ARCH_SUFFIX="amd64" ;;
    *)             echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
fi
export ARCH_SUFFIX

echo "Detected architecture: ${ARCH_SUFFIX}"

docker compose -f ${COMPOSE_FILE} up

