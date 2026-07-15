#!/bin/bash

# This script helps you set up a multiline POSITRON_DEV_LICENSE environment variable
# and run docker-compose with Ubuntu 24, Rocky 8, OpenSUSE 15.6, SLES 15.6, or Debian 12 configuration

# Default to ubuntu24 if no OS argument is provided
OS_TYPE="ubuntu24"

# Check for OS type argument
if [ "$1" = "ubuntu24" ] || [ "$1" = "rocky8" ] || [ "$1" = "opensuse156" ] || [ "$1" = "sles156" ] || [ "$1" = "debian12" ]; then
  OS_TYPE="$1"
fi

# Set docker-compose file based on OS type
COMPOSE_FILE="docker-compose.${OS_TYPE}.yml"

# Check if license.txt exists
if [ ! -f license.txt ]; then
  echo "Error: license.txt not found!"
  echo "Please create a license.txt file with your POSITRON_DEV_LICENSE content"
  echo "(Found in 1Password IDE/Workbench vault)"
  exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
  echo "Error: .env file not found!"
  echo ""
  if [ -f .env.example ]; then
    echo "Copy the example file and fill in the values:"
    echo "  cp .env.example .env"
  else
    echo "Create a .env file with:"
    echo "  E2E_POSTGRES_USER="
    echo "  E2E_POSTGRES_PASSWORD="
  fi
  echo ""
  echo "(Values found in 1Password: Positron > E2E Postgres DB Connection info)"
  exit 1
fi

# Load environment variables from .env file
# Only KEY=VALUE lines are processed to avoid executing arbitrary shell code
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

# Validate required environment variables
MISSING_VARS=()
if [ -z "$E2E_POSTGRES_USER" ]; then
  MISSING_VARS+=("E2E_POSTGRES_USER")
fi
if [ -z "$E2E_POSTGRES_PASSWORD" ]; then
  MISSING_VARS+=("E2E_POSTGRES_PASSWORD")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  echo "Error: Missing required environment variables in .env:"
  for var in "${MISSING_VARS[@]}"; do
    echo "  - $var"
  done
  echo ""
  echo "(Values found in 1Password: Positron > E2E Postgres DB Connection info)"
  exit 1
fi

# Check docker login status for ghcr.io by pulling the selected OS image
echo "Checking GitHub Container Registry authentication..."
GHCR_IMAGE=$(awk '/image:.*ghcr\.io/{
  # Extract the value after "image:", strip inline comments, then quotes
  sub(/^[[:space:]]*image:[[:space:]]*/, "")
  gsub(/[[:space:]]+#.*$/, "")
  gsub(/^["'"'"']|["'"'"']$/, "")
  gsub(/[[:space:]]+$/, "")
  print; exit
}' "$COMPOSE_FILE")
if [ -z "$GHCR_IMAGE" ]; then
  echo "Error: Could not determine ghcr.io image from $COMPOSE_FILE"
  exit 1
fi
if ! docker manifest inspect "$GHCR_IMAGE" >/dev/null 2>&1; then
  echo ""
  echo "Error: Not authenticated with GitHub Container Registry (ghcr.io)"
  echo ""
  echo "Please run:"
  echo "  docker login ghcr.io -u <your_github_username>"
  echo ""
  echo "Use a GitHub Personal Access Token with 'read:packages' scope as your password."
  exit 1
fi
echo "Docker authentication OK"

# Export the license as an environment variable, preserving newlines
export POSITRON_DEV_LICENSE=$(cat license.txt)

echo ""
echo "Starting containers for: $OS_TYPE"
docker compose -f ${COMPOSE_FILE} up
