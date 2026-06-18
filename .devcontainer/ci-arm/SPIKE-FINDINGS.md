# Task 0 Spike Findings — ci-arm dev container

Empirical results from the CI image `ghcr.io/posit-dev/positron-ubuntu24-arm64:127`
on macOS arm64 (Docker Desktop 28.3.0). These values are consumed by Tasks 1–6.

## Produced values

| Key | Value |
|---|---|
| `REMOTE_USER` | `root` (uid 0, gid 0) |
| `SUDO_AVAILABLE` | `true` (`/usr/bin/sudo` present; as root, chown also works without it) |
| `LICENSE_DEST` | `/positron-license/pdol/target/debug/pdol_rsa` (parent dir exists in image) |
| `WORKSPACE_FOLDER` | `/workspaces/positron` |
| `WORKSPACE_MOUNT_STRATEGY` | `bind+overlays` (see decision below) |
| `AMD64_TAG_EXISTS` | `false` — informational; Windows/amd64 is blocked on publishing an amd64 image |

Image also confirmed: `Xvfb` + `xdpyinfo` at `/usr/bin/`, node `v22.22.1`, npm `10.9.4`.

## Performance test (named Linux volume, compose backend)

- Clone (`--depth 1`) into the volume: **~9s**.
- `npm ci --fetch-timeout 120000`: **333s (~5.5 min), exit 0**, `node_modules` = **1.3G**.
- Conclusion: a Linux named volume builds the toolchain at native speed — no macOS
  bind-mount penalty on the large `node_modules` tree.

## Decision: `bind+overlays` is the primary mount strategy

The named volume performs natively, so the perf-critical dirs (`node_modules`, `.build`)
belong on Linux volumes either way. But VS Code's "Clone Repository in Container Volume"
is designed for image/Dockerfile dev containers, not compose backends — a pure named-volume
workspace starts empty, so the editor has nothing to read `devcontainer.json` from
(chicken-and-egg).

Therefore the workspace is a **bind mount of the host positron checkout** (so "Reopen in
Container" finds `.devcontainer/` on the opened folder), with **named-volume overlays** on
the heavy, platform-specific dirs:

```yaml
volumes:
  - ..:/workspaces/positron:cached          # host checkout (this repo)
  - positron-node-modules:/workspaces/positron/node_modules
  - positron-e2e-node-modules:/workspaces/positron/test/e2e/node_modules
  - positron-build:/workspaces/positron/.build
```

This keeps the source editable on the host disk while the perf killers run on fast Linux
volumes. (Docker Desktop VirtioFS file sharing recommended for the bind-mounted source.)

## Notes for later tasks

- Task 1: use the `bind+overlays` volume block above; the named workspace volume from the
  original plan draft is not used.
- Task 2: `LICENSE_DEST` is confirmed; `sudo` is available for the `chrome-sandbox` chown.
- Task 4: `remoteUser: root`.
