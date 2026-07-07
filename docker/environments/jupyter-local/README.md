# Jupyter + Positron Local Development Environment

This directory contains a Docker-based local development environment for testing Positron with JupyterHub using The Littlest JupyterHub (TLJH).

## Overview

- **Base OS**: Ubuntu 24.04
- **JupyterHub**: Installed via The Littlest JupyterHub (TLJH)
- **Positron Server**: Downloaded from [posit-dev/positron-builds](https://github.com/posit-dev/positron-builds)
- **Jupyter Positron Server**: Cloned from [posit-dev/jupyter-positron-server](https://github.com/posit-dev/jupyter-positron-server)

## Prerequisites

1. Docker and Docker Compose installed
2. GitHub Personal Access Token with access to `posit-dev/positron-builds` (private repo)
3. Positron license file (optional, for local development)

## Setup

### 1. Configure Environment Variables

```bash
cp .env.example .env
# Edit .env and add your GITHUB_TOKEN and JUPYTER_PASSWORD
```

### 2. Add License File (Optional)

For local development, place your `positron.lic` file in this directory. The file is git-ignored.

For CI, the license will come from a GitHub secret and will be mounted or copied into the container.

### 3. Authenticate with GitHub Container Registry

Before starting the container, authenticate with GHCR to pull the base image:

```bash
docker login ghcr.io -u <your_github_username>
```

> **Note:** When prompted for a password, enter your **GitHub Personal Access Token** (PAT), not your GitHub password. The token needs `read:packages` scope. You can create a token at https://github.com/settings/tokens

### 4. Start the Container

From the repository root:
```bash
npm run jupyter:start
```

Or from this directory:
```bash
./run.sh
```

This will:
- Pull the base Ubuntu 24 image from GHCR
- Start the container
- Keep it running in the background

### 5. Connect and Install

From the repository root:
```bash
npm run jupyter:connect
```

Or from this directory:
```bash
./connect.sh
```

This will:
- Copy installation scripts into the container (`/opt/scripts/`)
- Copy the license file (if present)
- Show current installation status
- Run the installation script
- Drop you into an interactive shell

For CI mode (non-interactive):
```bash
npm run jupyter:connect:ci
# Or: ./connect.sh --ci
```

### 6. Access JupyterHub

Once installation is complete:
- URL: http://localhost:8888
- Username: `admin`
- Password: Set on first login

Or use the configured user:
- Username: `user` (or your Q_USER from env)
- Password: Set on first login

**Note:** TLJH uses FirstUseAuthenticator - you set your password the first time you log in with a username.

### 7. Stop and Cleanup

From the repository root:
```bash
npm run jupyter:stop
```

Or from this directory:
```bash
./stop-containers.sh
```

## Scripts

### NPM Scripts (from repository root)

- `npm run jupyter:start` - Start the Docker Compose stack
- `npm run jupyter:connect` - Connect to container and run installation (interactive)
- `npm run jupyter:connect:ci` - Connect and install in CI mode (non-interactive)
- `npm run jupyter:stop` - Stop and remove all containers and volumes

### Shell Scripts (from this directory)

- **run.sh**: Start the Docker Compose stack
- **connect.sh**: Connect to the running container and run installation
- **stop-containers.sh**: Stop and remove all containers and volumes
- **install-jupyter-positron.sh**: Install JupyterHub, Positron, and configure them
- **positronDownload.sh**: Download the latest Positron server from GitHub releases

### Environment Variables

The following environment variables can be set in `.env` or passed directly:

- `GITHUB_TOKEN`: Required. GitHub token for accessing positron-builds
- `JUPYTER_PASSWORD`: Not used (TLJH manages passwords)
- `Q_USER`: Username for additional admin user (default: user)
- `ARCH_SUFFIX`: Architecture suffix (auto-detected: arm64 or amd64)
- `POSITRON_TAG`: Specific Positron release tag (default: latest)
- `LICENSE_FILE`: Path to license file (default: /opt/positron.lic)
- `IMAGE_TAG`: Docker image tag to use (default: latest)

**Note**: The `admin` user is always created with password `admin` for convenience.

## CI Integration

The CI process (running in a different repo) will:

1. Pull the base Ubuntu 24 image from GHCR:
   ```
   ghcr.io/posit-dev/positron-jupyter-ubuntu24-{ARCH}:{TAG}
   ```

2. Run the installation script from this repo:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/{ORG}/{REPO}/{BRANCH}/dockerfiles/jupyter-local/install-jupyter-positron.sh | bash -s -- --ci
   ```

3. The license will be provided via GitHub secret and written to `/opt/positron.lic` before running the install script.

## Architecture

The setup consists of:

1. **Base Image** (Dockerfile):
   - Ubuntu 24.04 with systemd
   - Basic system dependencies
   - Non-root user (jupyter-user)
   - **Note**: Requires systemd as PID 1 for TLJH to work properly

2. **Installation Script** (install-jupyter-positron.sh):
   - Installs TLJH
   - Downloads and extracts Positron server
   - Clones jupyter-positron-server
   - Configures JupyterHub to use Positron
   - Applies license

3. **Helper Scripts**:
   - positronDownload.sh: Downloads Positron from GitHub releases
   - connect.sh: Container connection helper
   - run.sh: Docker Compose wrapper
   - stop-containers.sh: Cleanup script

## Differences from wb-local

Unlike the `wb-local` directory which sets up Workbench with Connect and PostgreSQL:

- No Posit Connect container
- No PostgreSQL container
- Simpler architecture focused on Jupyter + Positron
- Uses TLJH instead of Workbench
- Builds Positron server from pre-built releases, not from source

## Troubleshooting

### Container won't start
```bash
npm run jupyter:stop
npm run jupyter:start
```

### Installation fails with "System has not been booted with systemd"
This means the container isn't running with systemd as PID 1. This should be handled by the docker-compose configuration, but if you see this error:
- Make sure you're using the provided docker-compose.ubuntu24.yml
- The container runs with `privileged: true` to support systemd
- The container command is set to `/lib/systemd/systemd`

### Script not found error
If you see `/opt/scripts/install-jupyter-positron.sh: No such file or directory`:
- The scripts are copied to `/opt/scripts/` (not `/tmp/`) to avoid tmpfs clearing
- Make sure you're running `connect.sh` from the `dockerfiles/jupyter-local` directory
- The scripts should be automatically copied when you run `npm run jupyter:connect`

### Python externally-managed-environment error
Ubuntu 24.04 uses PEP 668 to prevent system-wide Python package installations. The install script handles this by:
- Installing jupyter-positron-server into TLJH's user environment (`/opt/tljh/user`)
- This is where user notebook servers run, so packages are available to users
- If TLJH environments aren't found, it falls back to using `--break-system-packages`

### JupyterHub fails to start with "could not be imported" error
If you see errors about `pamauthenticator.PAMAuthenticator` not being imported:
```bash
# Reset auth configuration to TLJH's default
sudo tljh-config unset auth.type
sudo tljh-config reload
systemctl status jupyterhub
```
TLJH uses PAMAuthenticator by default, so no explicit configuration is needed.

### Installation fails
Check that:
- GITHUB_TOKEN is set and valid
- License file exists (if required)
- Architecture is supported (arm64 or amd64/x64)
- Container has systemd running: `docker exec jupyter-test systemctl status`

### Can't access JupyterHub
- Verify the container is running: `docker ps | grep jupyter-test`
- Check if systemd is running: `docker exec jupyter-test systemctl status`
- Check JupyterHub status inside container: `docker exec jupyter-test systemctl status jupyterhub`
- Check logs: `docker logs jupyter-test`
- Check JupyterHub logs: `docker exec jupyter-test journalctl -u jupyterhub -n 50`
