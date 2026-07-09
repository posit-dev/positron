# Positron CI Images

This repository contains Docker images used for Positron continuous integration (CI) pipelines in GitHub Actions. They are also intended for use in local development environments to mimic the CI setup.

## Repository Structure

- `ubuntu24_04/` - Docker configurations for Ubuntu 24.04 environments
  - Supports both AMD64 and ARM64 architectures
  - Includes PostgreSQL database configuration for testing
  - See the [Ubuntu 24.04 README](ubuntu24_04/README.md) for detailed information

- `rocky_8/` - Docker configurations for Rocky 8 environments
  - Supports both AMD64 and ARM64 architectures
  - Includes PostgreSQL database configuration for testing
  - See the [Rocky 8 README](rocky_8/README.md) for detailed information

## Purpose

These Docker images provide consistent testing environments for Positron across different architectures. They include:

- Build dependencies
- Required installations of R and Python, including packages used by the e2e test content (`test/e2e/test-files`)
- Runtime test dependencies such as Quarto
- The positron license server
- Fluxbox and x11vnc for locally viewing running tests

## Usage in GitHub Actions

These images are referenced in Positron CI workflows to ensure consistent test environments. The workflows typically:

1. Pull the specified images from GitHub Container Registry
2. Start db container and await its readiness
3. Start the test container with necessary environment variables

## Database Environment Variables

In order to connect to the PostgreSQL database within the Docker containers, the following environment variables must be set:

- `E2E_POSTGRES_USER` - PostgreSQL user for E2E tests (default: `testuser`)
- `E2E_POSTGRES_PASSWORD` - PostgreSQL password for E2E tests (default: `testpassword`)

The database names are no longer configurable — the Postgres container seeds two fixed databases:

- `periodic` - periodic table sample data
- `dvdrental` - DVD rental sample data

## Positron Server Development License

The Positron Server requires a development license which must be set in both GitHub Actions and local environments. The license is set in CI via the `POSITRON_DEV_LICENSE` secret. Locally, it is set via the license.txt file.

## Local Development
See the [Ubuntu 24.04 README](ubuntu24_04/README.md) for details.