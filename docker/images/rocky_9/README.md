# Rocky Linux 9 CI Images

Docker configuration for CI/testing environments based on Rocky Linux 9. Built
and published by `.github/workflows/ci-images-build-os.yml` (`os: rocky_9`) as
`ghcr.io/posit-dev/positron-rocky9:<tag>`.

## Why this exists alongside `rocky_8/`

This image was added for the Workbench e2e Rocky lane. Posit publishes **no
arm64 Workbench package for RHEL 8** (the dailies feed has `rhel8-x86_64` only),
so a Rocky 8 Workbench stack can only run emulated on Apple Silicon. RHEL 9 has
both arches on both channels, which keeps the local development loop native.

`rocky_8/` and `test-e2e-rocky.yml` are unaffected.

## What this image includes

- Rocky Linux 9 base
- R 4.5.2 and 4.4.2 (via rig), plus a "hidden" R 4.4.1 under `/root/scratch`
- Python environments: a uv-managed 3.10.12 venv, pyenv 3.13.0, and a conda
  3.12.10 env under `/root/scratch`
- Node.js, Quarto, TinyTeX, AWS CLI
- The R and Python packages used by the e2e test content (`test/e2e/test-files`)
- The Positron license server (`pdol`)
- TigerVNC and openbox for locally viewing running tests

## Differences from the Rocky 8 image

Rocky 8's Dockerfile carries a stack of workarounds for how old EL8 is. **None of
them are needed here, and they should not be copied over.**

| Rocky 8 does | Rocky 9 does | Why |
| --- | --- | --- |
| ~~Unpacks the Quarto `.deb` with `ar x`~~ (fixed -- now also installs the RPM) | `dnf install`s the published Quarto RPM | The `ar` extraction skips the package's postinst, which is what links the binary onto PATH -- it left quarto at `/opt/quarto/bin/quarto`, unreachable. EL8/EL9 are RPM-based, so both now install the RPM like the openSUSE/SLES images do. `quarto --version` runs in the same layer to assert it. |
| Builds GEOS 3.12, GDAL 3.9 and libgit2 1.8 from source | Uses the distro packages | EL9 + EPEL9 ship GEOS 3.13, GDAL 3.10, PROJ 9.6, libgit2 1.7 -- all *newer* than what Rocky 8 compiles by hand. EL8's GDAL 3.0.4 predates `GDAL_DCAP_MULTIDIM_RASTER`, which `terra` needs; EL9's does not. |
| Pins `gcc-toolset-13` and patches `Makeconf` for every R version | Uses system GCC 11 | EL8's GCC 8 has no C++20 (needed by Arrow). GCC 11 does. |
| Installs system TeX Live on arm64 instead of TinyTeX | TinyTeX on both arches | TinyTeX binaries need glibc >= 2.29; EL8 has 2.28, EL9 has 2.34. |
| Pins `sf@1.0-20` and constrains bokeh/panel/holoviews/hvplot | Installs `DESCRIPTION` / `requirements.txt` as-is | Those pins worked around EL8 source-build failures and wheel availability. |
| `--set-enabled powertools` | `--set-enabled crb` | EL9 renamed PowerTools to CodeReady Builder. |
| ~~PPM channel `__linux__/rockylinux8`~~ (fixed -- now `centos8`) | PPM channel `__linux__/rhel9` | **`rockylinux8` was not a real PPM channel** and 404d, so R saw zero packages and fell back to source builds. The valid names come from `https://packagemanager.posit.co/__api__/status` -> `.distros[].binaryURL`: `rhel8` maps to `centos8`, and Rocky 9 is `rhel9`. Using a real channel means R packages arrive as binaries instead of compiling. |

Package-name changes from EL8 to EL9 are handled in `deps/rocky9_packages_*.txt`:
`procps`->`procps-ng`, `postgresql-devel`/`postgresql-libs`->`libpq-devel`/`libpq`,
`dnf-utils`->`dnf-plugins-core`, `mesa-libGLES`->`libglvnd-gles`,
`fluxbox`->`openbox` (fluxbox is not in EPEL9), `xauth`->`xorg-x11-xauth`,
`xdpyinfo`->`xorg-x11-utils`, `xset`->`xorg-x11-server-utils`, and `glibc-headers`
is dropped (merged into `glibc-devel`). `acl` and `environment-modules` are
included here but missing from the Rocky 8 lists.

Two packages are listed explicitly because EL8 supplied them transitively and
EL9's leaner base does not:

- `perl` -- `tlmgr` is a Perl script, and EL9's minimal Perl has no `File::Find`,
  so the TinyTeX installer fails with "perl is required but not found".
- `libxcrypt-compat` -- EL9 moved to libxcrypt (`libcrypt.so.2`), but uv's
  prebuilt CPython links `libcrypt.so.1`, so `uv venv` fails with
  "error while loading shared libraries: libcrypt.so.1".

The `dnf install` uses `--allowerasing` because the EL9 base image ships
`curl-minimal`/`libcurl-minimal`, which conflict with the full `curl` and with
the `libcurl-devel` that R's `curl` package needs.

## Usage

### AMD64

```bash
cd docker/images/rocky_9
GITHUB_TOKEN=$(gh auth token) docker buildx bake -f docker-compose.amd64.yml test \
  --set test.platform=linux/amd64 --load
```

### ARM64

```bash
cd docker/images/rocky_9
GITHUB_TOKEN=$(gh auth token) docker buildx bake -f docker-compose.arm64.yml test \
  --set test.platform=linux/arm64 --load
```

`GITHUB_TOKEN` is required -- it is passed as the `TOKEN` build arg to clone
`posit-dev/positron-license`.

## Environment Variables

- `E2E_POSTGRES_USER`: Database username (default: `testuser`)
- `E2E_POSTGRES_PASSWORD`: Database password (default: `testpassword`)
- `GITHUB_TOKEN`: GitHub token for private repository access
- `POSITRON_DEV_LICENSE`: Development license for Positron

The Postgres container (built from the shared [`../postgres/`](../postgres/)
directory) seeds two fixed databases: `periodic` and `dvdrental`.
