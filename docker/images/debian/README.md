# Positron CI Environment (Debian 12)

This directory contains Docker configurations used in GitHub Actions for testing Positron against Debian 12 on both ARM64 and AMD64 architectures.

## Directory Structure

- `Dockerfile.debian12` - Dockerfile for AMD64 and ARM64 architectures
- `docker-compose.arm64.yml` - Docker Compose file for ARM64 architecture
- `docker-compose.amd64.yml` - Docker Compose file for AMD64 architecture
- `deps/` - Shared dependencies used by both architectures
  - `debian12_packages_amd64.txt` - Package list for AMD64 architecture
  - `debian12_packages_arm64.txt` - Package list for ARM64 architecture

The PostgreSQL database image is built from the shared [`../postgres/`](../postgres/) directory (`Dockerfile.postgres` and `init-scripts/`), referenced by the `db` service in the compose files. See [../postgres/](../postgres/).

## GitHub Actions Usage

This docker image is used in GitHub Actions workflows for testing Positron. This includes the PR, Merge, Full Suite, Release, and Extension Verification workflows.

## Local Development
See the [Debian 12 Local ARM](https://github.com/posit-dev/qa-example-content/tree/main/dockerfiles/arm-local) for details.
