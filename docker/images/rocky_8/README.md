# Rocky Linux 8 CI Images

This directory contains Docker configurations for CI/testing environments based on Rocky Linux 8.

## Docker Images

### Main Image (Dockerfile.rocky_8)
This image includes:
- Rocky Linux 8 base
- R 4.4.0 and 4.4.2 (via rig)
- Python environments (system Python, pyenv, conda)
- Node.js
- TinyTeX
- Quarto
- AWS CLI
- Development tools

### Postgres Image (../postgres/Dockerfile.postgres)
Standard Postgres image with initialization scripts for testing environments. Built from the shared [`../postgres/`](../postgres/) directory and referenced by the `db` service in the compose files.

## Usage

### For AMD64 architecture:
```bash
cd rocky_8
docker-compose -f docker-compose.amd64.yml up -d
```

### For ARM64 architecture:
```bash
cd rocky_8
docker-compose -f docker-compose.arm64.yml up -d
```

## Environment Variables

The following environment variables can be set:
- `E2E_POSTGRES_USER`: Database username (default: testuser)
- `E2E_POSTGRES_PASSWORD`: Database password (default: testpassword)
- `GITHUB_TOKEN`: GitHub token for private repository access
- `POSITRON_DEV_LICENSE`: Development license for Positron

The Postgres container seeds two fixed databases: `periodic` (periodic table data)
and `dvdrental` (DVD rental data).

## Init Scripts

The shared [`../postgres/init-scripts`](../postgres/init-scripts) directory contains the initialization script run by the Postgres entrypoint:
- `10-init-databases.sh`: Creates the `periodic` and `dvdrental` databases and loads each dump from [`../postgres/sql`](../postgres/sql) (`periodic_table.sql`, `dvdrental.sql`).
