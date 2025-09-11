#!/bin/bash

# Start the Positron code server for external e2e testing
# Usage: ./scripts/start-e2e-server.sh [port] [token]

PORT=${1:-8080}
TOKEN=${2:-dev-token}

# Use a fixed user data directory for e2e testing in the home directory
USER_DATA_DIR="$HOME/.positron-e2e-test"

echo "Starting Positron code server for e2e testing..."
echo "Port: $PORT"
echo "Token: $TOKEN"
echo "User Data Dir: $USER_DATA_DIR"
echo "URL: http://localhost:$PORT/?tkn=$TOKEN"
echo ""

# Create user data directory structure if it doesn't exist
mkdir -p "$USER_DATA_DIR/User"

# Copy test fixtures (keybindings and settings) to the server's user data directory
FIXTURES_DIR="$(dirname "$0")/../test/e2e/fixtures"
USER_DIR="$USER_DATA_DIR/User"

echo "Fixtures directory: $FIXTURES_DIR"
echo "User directory: $USER_DIR"
echo "Looking for keybindings.json at: $FIXTURES_DIR/keybindings.json"

# Copy keybindings.json for hotkey support to User directory (user shortcuts location)
if [ -f "$FIXTURES_DIR/keybindings.json" ]; then
	echo "Found keybindings.json, copying to User directory..."
	cp "$FIXTURES_DIR/keybindings.json" "$USER_DIR/keybindings.json" && echo "Successfully copied keybindings.json" || echo "Failed to copy keybindings.json"
	ls -la "$USER_DIR/keybindings.json" || echo "keybindings.json not found after copy"
else
	echo "Error: keybindings.json not found at $FIXTURES_DIR/keybindings.json"
	ls -la "$FIXTURES_DIR/" || echo "Fixtures directory not found"
fi

# Copy settings.json to User directory
SETTINGS_FILE="$USER_DIR/settings.json"
if [ -f "$FIXTURES_DIR/settings.json" ]; then
	echo "Copying settings.json from test fixtures..."
	cp "$FIXTURES_DIR/settings.json" "$SETTINGS_FILE"
elif [ ! -f "$SETTINGS_FILE" ]; then
	echo '{}' > "$SETTINGS_FILE"
	echo "Created empty settings.json at $SETTINGS_FILE"
fi

# Cleanup function to remove user data directory on exit
cleanup() {
	echo "Cleaning up user data directory: $USER_DATA_DIR"
	rm -rf "$USER_DATA_DIR"
}

# Set up cleanup on script exit
trap cleanup EXIT

# Start the server with explicit user data directory and additional e2e options
./scripts/code-server.sh --no-launch --connection-token "$TOKEN" --port "$PORT" \
	--user-data-dir "$USER_DATA_DIR" \
	--disable-telemetry \
	--disable-experiments \
	--skip-welcome \
	--skip-release-notes \
	--no-cached-data \
	--disable-updates \
	--use-inmemory-secretstorage \
	--disable-workspace-trust
