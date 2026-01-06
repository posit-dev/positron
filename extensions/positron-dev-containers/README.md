# Dev Containers Extension for Positron

## Overview

The Dev Containers extension enables you to open any folder or repository inside a Docker container and take advantage of Positron's full feature set within that containerized environment. This allows you to define your project's dependencies declaratively, install them in a lightweight container, and run the entire project inside the container with a consistent, reproducible development environment.

For compatibility with VS Code, this extension uses most of the same command IDs and setting names from VS Code's version of the extension. The extension itself is novel code, with the exception of the contents of the `spec` folder, which is adapted from the MIT-licensed [dev container reference implementation](https://github.com/devcontainers/cli).

## Requirements

- Docker or Podman installed and running
- A workspace with a `.devcontainer.json` or `.devcontainer/devcontainer.json` file

## Configuration

Enable the extension in your settings:

```json
{
  "dev.containers.enable": true
}
```

## Usage

### Opening a Folder in a Container

1. Open a folder that contains a `.devcontainer.json` file
2. Click the notification prompt, or
3. Use the command palette: **Dev Containers: Reopen in Container**

### Attaching to a Running Container

1. Open the Remote Explorer view
2. Expand the "Dev Containers" section
3. Right-click a running container and select "Attach in Current Window" or "Attach in New Window"

### Rebuilding a Container

When you've made changes to your `devcontainer.json` or `Dockerfile`:

- **Dev Containers: Rebuild Container** - Rebuild using cache
- **Dev Containers: Rebuild Without Cache** - Full rebuild from scratch
- **Dev Containers: Rebuild and Reopen in Container** - Rebuild and automatically reopen

### Key Components

#### Extension Entry Point (`extension.ts`)
- Activates the extension when enabled
- Registers commands, views, and authority resolvers
- Initializes core managers and services
- Handles pending rebuild requests

#### Remote Authority Resolver (`remote/authorityResolver.ts`)
- Resolves `dev-container://` and `attached-container://` URIs
- Manages connections to containers
- Handles workspace folder resolution
- Implements VS Code's remote development protocol

#### Connection Manager (`remote/connectionManager.ts`)
- Manages active connections to containers
- Tracks connection state and lifecycle
- Handles connection failures and recovery
- Coordinates with port forwarding

#### Dev Container Manager (`container/devContainerManager.ts`)
- Creates and starts containers from `devcontainer.json`
- Handles container building and rebuilding
- Manages container lifecycle (start, stop, remove)
- Retrieves container information and logs

#### Server Installer (`server/serverInstaller.ts`)
- Downloads the Positron server for the container platform
- Installs and configures the server inside containers
- Generates connection tokens for secure communication
- Handles server updates and versioning

#### Workspace Mapping Storage (`common/workspaceMappingStorage.ts`)
- Persists mappings between container IDs and workspace paths
- Enables proper workspace resolution across window reloads
- Provides cleanup for stale mappings

#### Dev Container Reference CLI (spec/)
- Copy of the Microsoft Dev Container Reference CLI
- Used to manage containers and form Docker commands

### Remote Development Flow

The workflow typically looks like this;

1.  User invokes "Reopen in Container"
2.  Extension reads `devcontainer.json` and creates/starts container
3.  Positron server is downloaded and installed in container
4.  VS Code resolves the remote authority and establishes connection
5.  Extension maps local paths to container paths
6.  Necessary ports are forwarded from container to host
7.  User can now work with code inside the container

## Known Limitations

- Requires glibc-based Linux since Positron Server builds of Linux require glibc (e.g. Alpine will not work)
- Doesn't support "Create from template"; you need to create Dockerfiles / devcontainer JSON files by hand
- Doesn't support development volumes (popular feature from VS Code's implementation, used for e.g. faster I/O)
- Container management views and features are not available if you are inside a container/remote
- Currently experimental and requires explicit enablement
- Requires Docker or Podman to be installed and running
- GPU support is platform-dependent
- Some features have limited support in containers

