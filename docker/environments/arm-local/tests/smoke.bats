#!/usr/bin/env bats
# smoke.bats - Smoke tests for arm-local shell scripts
#
# Requires bats-core: https://github.com/bats-core/bats-core
# Install: brew install bats-core
# Run: bats tests/smoke.bats

SCRIPTS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

# ---------------------------------------------------------------------------
# connect.sh
# ---------------------------------------------------------------------------

@test "connect.sh --help exits 0 and prints usage" {
  run "$SCRIPTS_DIR/connect.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "connect.sh unknown flag exits non-zero" {
  run "$SCRIPTS_DIR/connect.sh" --unknown-flag
  [ "$status" -ne 0 ]
  [[ "$output" == *"Unknown option"* ]]
}

@test "connect.sh --ci requires a branch name" {
  run "$SCRIPTS_DIR/connect.sh" --ci
  [ "$status" -ne 0 ]
  [[ "$output" == *"--ci requires a branch name"* ]]
}

@test "connect.sh --ci with branch parses branch correctly" {
  # No Docker → falls through to container-not-running check.
  # We just verify the argument parsing doesn't abort early.
  run "$SCRIPTS_DIR/connect.sh" --ci some-branch
  # Either exits because Docker/container not found, or succeeds — not an arg-parse error.
  [[ "$output" != *"--ci requires a branch name"* ]]
  [[ "$output" != *"Unknown option"* ]]
}

# ---------------------------------------------------------------------------
# status.sh
# ---------------------------------------------------------------------------

@test "status.sh exits 0 when no containers are running" {
  # Stub docker to report no running containers.
  docker() {
    if [[ "$1 $2" == "ps --format" ]]; then
      echo ""
    else
      command docker "$@"
    fi
  }
  export -f docker

  run "$SCRIPTS_DIR/status.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"None running"* ]]
}

# ---------------------------------------------------------------------------
# setup-test-env.sh
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# .env loading (connect.sh)
# ---------------------------------------------------------------------------
# Helper: create a mock docker binary in $1/bin that:
#   - ps: prints "test" so the container-running check passes
#   - cp: exits 0 silently
#   - exec: prints all env vars whose name starts with TEST_ or ends in _VAR,
#           then exits 0 (simulates entering the container)
_setup_mock_docker() {
  local bindir="$1/bin"
  mkdir -p "$bindir"
  cat > "$bindir/docker" << 'DOCKEREOF'
#!/bin/bash
case "$1" in
  ps)   echo "test container" ;;
  cp)   exit 0 ;;
  exec) env | grep -E '^(MY_TEST_VAR|MY_VAR|SAFE_VAR)=' ; exit 0 ;;
  *)    exit 0 ;;
esac
DOCKEREOF
  chmod +x "$bindir/docker"
}

@test "connect.sh loads plain KEY=VALUE from .env" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  echo "MY_TEST_VAR=hello_world" > "$tmpdir/.env"
  _setup_mock_docker "$tmpdir"

  run env PATH="$tmpdir/bin:$PATH" bash -c "cd '$tmpdir' && '$SCRIPTS_DIR/connect.sh' --ci dummy-branch"
  [ "$status" -eq 0 ]
  [[ "$output" == *"MY_TEST_VAR=hello_world"* ]]
  rm -rf "$tmpdir"
}

@test "connect.sh ignores .env lines with shell metacharacters in key" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  printf 'SAFE_VAR=ok\n$(touch /tmp/pwned)=bad\n' > "$tmpdir/.env"
  _setup_mock_docker "$tmpdir"

  run env PATH="$tmpdir/bin:$PATH" bash -c "cd '$tmpdir' && '$SCRIPTS_DIR/connect.sh' --ci dummy-branch"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SAFE_VAR=ok"* ]]
  # Malicious key must not have been executed
  [ ! -f /tmp/pwned ]
  rm -rf "$tmpdir"
}

@test "connect.sh loads .env value that contains spaces" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  echo 'MY_VAR=hello world' > "$tmpdir/.env"
  _setup_mock_docker "$tmpdir"

  run env PATH="$tmpdir/bin:$PATH" bash -c "cd '$tmpdir' && '$SCRIPTS_DIR/connect.sh' --ci dummy-branch"
  [ "$status" -eq 0 ]
  [[ "$output" == *"MY_VAR=hello world"* ]]
  rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# GHCR image extraction (run-with-license.sh)
# ---------------------------------------------------------------------------
# Helper: set up a temp dir to run run-with-license.sh with a given compose content.
# The mock docker records the image passed to "docker pull" in $tmpdir/pulled_image.
_run_with_license_setup() {
  local tmpdir="$1"
  local compose_content="$2"

  echo "license content" > "$tmpdir/license.txt"
  printf 'E2E_POSTGRES_USER=user\nE2E_POSTGRES_PASSWORD=pass\n' > "$tmpdir/.env"
  printf '%s' "$compose_content" > "$tmpdir/docker-compose.ubuntu24.yml"

  mkdir -p "$tmpdir/bin"
  cat > "$tmpdir/bin/docker" << 'DOCKEREOF'
#!/bin/bash
case "$1" in
  pull)
    echo "PULLED_IMAGE=$2"
    exit 0
    ;;
  compose)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
DOCKEREOF
  chmod +x "$tmpdir/bin/docker"
}

@test "GHCR image extraction handles unquoted image value" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  _run_with_license_setup "$tmpdir" \
    "$(printf 'services:\n  test:\n    image: ghcr.io/org/image:tag\n')"

  run env PATH="$tmpdir/bin:$PATH" bash -c "cd '$tmpdir' && '$SCRIPTS_DIR/run-with-license.sh' ubuntu24"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PULLED_IMAGE=ghcr.io/org/image:tag"* ]]
  rm -rf "$tmpdir"
}

@test "GHCR image extraction handles double-quoted image value" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  _run_with_license_setup "$tmpdir" \
    "$(printf 'services:\n  test:\n    image: "ghcr.io/org/image:tag"\n')"

  run env PATH="$tmpdir/bin:$PATH" bash -c "cd '$tmpdir' && '$SCRIPTS_DIR/run-with-license.sh' ubuntu24"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PULLED_IMAGE=ghcr.io/org/image:tag"* ]]
  rm -rf "$tmpdir"
}

@test "GHCR image extraction handles single-quoted image value" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  _run_with_license_setup "$tmpdir" \
    "$(printf "services:\n  test:\n    image: 'ghcr.io/org/image:tag'\n")"

  run env PATH="$tmpdir/bin:$PATH" bash -c "cd '$tmpdir' && '$SCRIPTS_DIR/run-with-license.sh' ubuntu24"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PULLED_IMAGE=ghcr.io/org/image:tag"* ]]
  rm -rf "$tmpdir"
}

@test "GHCR image extraction strips inline YAML comment" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  _run_with_license_setup "$tmpdir" \
    "$(printf 'services:\n  test:\n    image: "ghcr.io/org/image:tag" # inline comment\n')"

  run env PATH="$tmpdir/bin:$PATH" bash -c "cd '$tmpdir' && '$SCRIPTS_DIR/run-with-license.sh' ubuntu24"
  [ "$status" -eq 0 ]
  [[ "$output" == *"PULLED_IMAGE=ghcr.io/org/image:tag"* ]]
  # Ensure no trailing quote leaked through
  [[ "$output" != *'PULLED_IMAGE=ghcr.io/org/image:tag"'* ]]
  rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# setup-test-env.sh
# ---------------------------------------------------------------------------

@test "setup-test-env.sh prints usage when called with no args" {
  run "$SCRIPTS_DIR/setup-test-env.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "setup-test-env.sh prints usage with -h flag" {
  run "$SCRIPTS_DIR/setup-test-env.sh" -h
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "setup-test-env.sh prints usage with --help flag" {
  run "$SCRIPTS_DIR/setup-test-env.sh" --help
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}
