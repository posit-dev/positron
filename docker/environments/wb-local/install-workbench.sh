#!/bin/bash

# Initialize error tracking
ERRORS=()

# Function to log errors
log_error() {
    ERRORS+=("$1")
    echo "❌ ERROR: $1"
}

# Parse command line arguments
CI_MODE=false
CI_STABLE_MODE=false
CREDENTIALS=""
while [ $# -gt 0 ]; do
  case $1 in
    --ci)
      CI_MODE=true
      shift
      ;;
    --ci-stable)
      CI_STABLE_MODE=true
      shift
      ;;
    --credentials=*)
      CREDENTIALS="${1#*=}"
      shift
      ;;
    --credentials)
      CREDENTIALS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate credential type if provided
if [ -n "${CREDENTIALS}" ]; then
    case "${CREDENTIALS}" in
        databricks|snowflake|azure) ;;
        *)
            echo "Invalid --credentials value: '${CREDENTIALS}' (expected: databricks, snowflake, or azure)"
            exit 1
            ;;
    esac
fi

# Interactive installation prompt (skip in CI mode)
if [ "$CI_MODE" = true ]; then
    echo ""
    echo "CI Mode: Installing latest versions..."
    echo "======================================"
elif [ "$CI_STABLE_MODE" = true ]; then
    echo ""
    echo "CI Stable Mode: Installing latest Positron + released Workbench..."
    echo "======================================================================"
elif [ -z "${WB_URL}" ] && [ -z "${POSITRON_TAG}" ]; then
    echo ""
    echo "Workbench + Positron Installation"
    echo "---------------------------------"
    if [ "$ALREADY_INSTALLED" = "true" ]; then
        echo "1) Update to latest versions"
        echo "2) Specific versions"
        echo "3) Skip to shell           [recommended - already installed]"
        DEFAULT_CHOICE=3
    else
        echo "1) Latest versions         [recommended]"
        echo "2) Specific versions"
        echo "3) Skip to shell"
        DEFAULT_CHOICE=1
    fi
    echo ""
    read -p "Enter your choice [1-3, default = $DEFAULT_CHOICE]: " choice

    case ${choice:-$DEFAULT_CHOICE} in
        1)
            if [ "$ALREADY_INSTALLED" = "true" ]; then
                echo "Updating to latest versions..."
            else
                echo "Installing latest versions..."
            fi
            ;;
        2)
            echo ""
            echo "Enter specific versions (or press Enter for defaults):"
            read -p "Workbench URL [press Enter for latest]: " user_wb_url
            read -p "Positron tag (e.g., 2025.10.0-88) [press Enter for latest]: " user_positron_tag

            if [ -n "$user_wb_url" ]; then
                export WB_URL="$user_wb_url"
            fi
            if [ -n "$user_positron_tag" ]; then
                export POSITRON_TAG="$user_positron_tag"
            fi
            ;;
        3)
            echo "Skipping installation. Going to shell..."
            exec /bin/bash
            ;;
        *)
            echo "Invalid choice. Using latest versions..."
            ;;
    esac
    echo ""
fi

# ensure_connect_token is defined in ensure-connect-token.sh (copied alongside
# this script into /tmp). Sourcing it here keeps the Workbench flow and the
# standalone connect-local bootstrap using the exact same logic.
source "$(dirname "${BASH_SOURCE[0]}")/ensure-connect-token.sh"
# workbench-local-lib.sh is copied in alongside us too. It owns every per-OS
# fact (package format, feed keys, the arm64 URL rewrites), so the daily/stable
# URL resolution here is the same code the host-side picker runs.
source "$(dirname "${BASH_SOURCE[0]}")/workbench-local-lib.sh"

# Every zypper call goes through this, and the PATH override is the whole point.
#
# The openSUSE image puts /opt/conda/bin first on PATH (its Dockerfile needs
# conda's python on PATH for the interpreter tests). zypper shells out to
# `repo2solv` *by name* to build its metadata cache, and conda ships its own
# libsolv whose repo2solv is compiled without rpm-md support -- so conda's is the
# one zypper finds, and every `zypper refresh` fails with:
#
#   repo2solv ... rpmmd repo type is not supported
#   Skipping repository '...' because of the above error.
#
# which reads like a broken mirror rather than a shadowed binary. zypper then has
# no package names at all, so every install afterwards fails with the equally
# misleading "'jq' not found in package names". Putting the system bin
# directories first is the entire fix; verified against this image.
#
# --force-resolution because sysvinit-tools, which supplies the startproc and
# killproc the SUSE init scripts call, conflicts with the
# busybox-sysvinit-tools the image ships. Nothing on the image requires the
# busybox variant and it provides a strict subset (pidof, killall5, fsync,
# usleep -- no startproc), so having zypper resolve the conflict by replacing it
# is the outcome we want, not one we are tolerating.
wb_zypper() {
    sudo env PATH="/usr/sbin:/usr/bin:/sbin:/bin" zypper --non-interactive "$@"
}

# Stop rserver and *verify* it exited. Do not trust `rstudio-server stop`'s exit
# status: on EL9 the init script's status check uses `pidof -c`, which cannot see
# rserver inside a container, so the stop short-circuits to a silent no-op and
# still returns 0. Signal directly, poll, then escalate -- a settled rserver
# exits on TERM in about a second, but one left wedged by a bad restart has been
# observed surviving 30s of TERM.
stop_rserver() {
    sudo rstudio-server stop >/dev/null 2>&1 || true
    pgrep -x rserver >/dev/null 2>&1 || return 0
    echo "Stopping rserver..."
    sudo pkill -x rserver 2>/dev/null || true
    local i
    for i in $(seq 1 15); do
        pgrep -x rserver >/dev/null 2>&1 || return 0
        sleep 1
    done
    echo "rserver did not exit on TERM - sending KILL..."
    sudo pkill -KILL -x rserver 2>/dev/null || true
    for i in $(seq 1 5); do
        pgrep -x rserver >/dev/null 2>&1 || return 0
        sleep 1
    done
    log_error "rserver still running after KILL"
    return 1
}

# Start the session launcher, then rserver. Order matters: rserver's
# LauncherClient::initialize() fails with ENOENT and rserver shuts itself down if
# /var/run/rstudio-server/rserver-launcher.socket does not exist yet, so wait for
# the socket rather than for the process.
LAUNCHER_SOCKET=/var/run/rstudio-server/rserver-launcher.socket
# Leading [/] so the pattern cannot match a shell whose own command line quotes
# it -- see the same note in workbench-local.sh.
LAUNCHER_PGREP='[/]usr/lib/rstudio-server/bin/rstudio-launcher'

# Create the runtime directory the launcher binds its socket in, owned by the
# user the launcher runs as.
#
# rserver creates /var/run/rstudio-server itself at startup and gives it to the
# server-user -- but we have to start the LAUNCHER first, because rserver shuts
# itself down if the launcher socket is missing. The launcher drops privileges to
# that same server-user before binding, so on a fresh container it finds a
# root-owned (or absent) directory and dies immediately:
#
#   ERROR system error 13 (Permission denied)
#     [stream: /var/run/rstudio-server/rserver-launcher.socket]
#
# and then rserver has no socket to connect to, so :8787 never comes up at all.
# Nothing else creates this directory in a container: the rpm ships no
# tmpfiles.d config, and neither the systemd units nor the SysV scripts make it
# -- the same class of gap as the missing init scripts.
#
# Mode 1777 and the ownership are what a successful rserver start produces, so
# this is not a loosening; it is doing early what rserver would have done later.
# Reads server-user from launcher.conf rather than assuming, since it has to
# match what rserver uses.
prepare_runtime_dir() {
    local server_user
    server_user="$(awk -F= '/^server-user=/{print $2}' /etc/rstudio/launcher.conf 2>/dev/null | tr -d '[:space:]')"
    server_user="${server_user:-rstudio-server}"
    if ! sudo install -d -m 1777 -o "${server_user}" -g "${server_user}" /var/run/rstudio-server; then
        log_error "Failed to prepare /var/run/rstudio-server for ${server_user}"
    fi
}

start_workbench() {
    local i
    if [ "${WB_FAMILY}" != "debian" ]; then
        prepare_runtime_dir
        # How the launcher gets started depends on the family, because only one of
        # the two rpm init scripts is usable in this container. Keep this in step
        # with wb_ensure_workbench in workbench-local.sh, which has to make the
        # same choice from the host side.
        if ! pgrep -f "${LAUNCHER_PGREP}" >/dev/null 2>&1; then
            echo "Starting rstudio-launcher..."
            sudo rm -f "${LAUNCHER_SOCKET}"
            if [ "${WB_FAMILY}" = "suse" ]; then
                # SUSE's script works: `startproc -s -q` on the launcher binary,
                # which brings the socket up in about a second. Use the packaged
                # path rather than hand-detaching the binary -- an earlier
                # revision of this ran the redhat branch below on SUSE too, "for
                # one code path", and the socket never appeared at all on the CI
                # runner while working locally. Whatever the direct start needs
                # that it did not get there, the init script does not need it.
                #
                # `|| true` because startproc's exit status is as unreliable here
                # as the rest: it reports failure whenever it cannot match the
                # process through /proc/<pid>/exe (which is how it behaves under
                # Rosetta) while having started the launcher perfectly well. The
                # socket check below is the real verdict.
                sudo /etc/init.d/rstudio-launcher start || true
            else
                # The rstudio-launcher script the rpm ships is unusable on EL9:
                # its install guard tests $rserver, which that script never
                # defines (so start silently exits 0); it passes
                # --name/--pidfiles/--stop to `daemon`, none of which EL9's
                # initscripts supports; and the launcher does not self-daemonize
                # the way rserver does, so a plain `daemon` call would block
                # forever. Start it directly instead.
                sudo nohup setsid /usr/lib/rstudio-server/bin/rstudio-launcher \
                    >/var/log/rstudio-launcher.stdout.log 2>&1 &
            fi
        fi
        # Generous cap because this exits as soon as the socket shows up: a couple
        # of seconds natively, longer in an emulated container (openSUSE on Apple
        # Silicon, which has no arm64 Workbench package).
        for i in $(seq 1 90); do
            [ -S "${LAUNCHER_SOCKET}" ] && break
            sleep 1
        done
        if [ ! -S "${LAUNCHER_SOCKET}" ]; then
            # Fatal, not accumulated: rserver calls LauncherClient::initialize()
            # at startup and shuts itself down with ENOENT when this socket is
            # missing, so everything after this point is guaranteed to fail. It
            # used to be a log_error, and the install went on to "complete" with a
            # warning -- then the real damage surfaced minutes later as a bare
            # ":8787 never answered" from a different step, which is a much harder
            # thing to read. Dump what we know before giving up.
            log_error "rstudio-launcher socket never appeared at ${LAUNCHER_SOCKET}"
            echo "--- rstudio-launcher processes ---"
            pgrep -af "${LAUNCHER_PGREP}" || echo "(none running)"
            echo "--- /var/log/rstudio-launcher.stdout.log ---"
            sudo tail -50 /var/log/rstudio-launcher.stdout.log 2>/dev/null || echo "(absent)"
            echo "--- /var/log/rstudio/launcher ---"
            sudo tail -n 50 /var/log/rstudio/launcher/* 2>/dev/null || echo "(absent)"
            echo ""
            echo "Aborting: rserver cannot start without the launcher socket."
            exit 1
        fi
    fi
    # Judge the start by whether rserver is running, not by the init script's
    # exit status, which is not trustworthy in a container on either rpm OS:
    # EL9's checks with `pidof -c` and SUSE's with `checkproc`, and neither can
    # see rserver here. On openSUSE this was observed printing
    # "Starting rstudio-server ..failed" and exiting non-zero while rserver was
    # up and :8787 was serving 302 -- checkproc matches through
    # /proc/<pid>/exe, which is not readable for a process running under
    # Rosetta. `pgrep -x` reads comm instead and is correct in both cases.
    sudo rstudio-server start || true
    for i in $(seq 1 30); do
        pgrep -x rserver >/dev/null 2>&1 && return 0
        sleep 1
    done
    log_error "Failed to start RStudio server (rserver is not running)"
}

# Initial parameter setup - auto-detect architecture if not set
if [ -z "${ARCH_SUFFIX:-}" ]; then
  case "$(uname -m)" in
    aarch64|arm64) ARCH_SUFFIX="arm64" ;;
    x86_64|amd64)  ARCH_SUFFIX="amd64" ;;
    *)             ARCH_SUFFIX="arm64" ;;
  esac
fi
POSITRON_TAG=${POSITRON_TAG:-""}  # Empty default will get the latest release
GITHUB_TOKEN=${GITHUB_TOKEN:-"myToken"}
# Host OS of this container: ubuntu24 (apt/.deb), rocky9 (dnf/.rpm) or
# opensuse15 (zypper/.rpm). Same vocabulary the --os flag and the compose image
# use -- see workbench-local-lib.sh.
WB_OS=${WB_OS:-"ubuntu24"}
if ! wb_os_valid "${WB_OS}"; then
    exit 1
fi
WB_PKG_EXT="$(wb_os_pkg_ext "${WB_OS}")"
# The OS-specific steps below branch on the *family* (debian|redhat|suse), not
# the OS. Both rpm families need the same handling in most places and differ in
# only a few, so a family branch keeps each step to the distinctions that are
# real. It is also the name of the extras/init.d/<family> directory the package
# ships, which the SysV install below relies on.
WB_FAMILY="$(wb_os_family "${WB_OS}")"

# User configuration with defaults that can be overridden by environment variables
Q_USER=${Q_USER:-"user1"}
Q_UID=${Q_UID:-1100}
Q_GID=${Q_GID:-1100}
Q_GROUP=${Q_GROUP:-"user1g"}
WB_PASSWORD=${WB_PASSWORD:-"testpassword"}

# Install required packages early so we have jq for URL fetching
echo "Installing required packages (${WB_OS})..."
case "${WB_FAMILY}" in
    redhat)
        # initscripts provides /etc/rc.d/init.d/functions, which the SysV scripts
        # the Workbench rpm ships in extras/init.d/redhat/ source on line 8. The
        # rpm's postinst installs systemd units instead of those scripts, and this
        # container has no systemd, so we copy them in by hand after the install
        # below.
        if ! sudo dnf install -y acl jq curl initscripts; then
            log_error "Failed to install required packages (acl, jq, curl, initscripts)"
        fi
        ;;
    suse)
        # Same reason as redhat, different providers: the SysV scripts in
        # extras/init.d/suse/ source /etc/rc.status (from aaa_base, already on the
        # image) and call startproc/killproc, which come from sysvinit-tools. The
        # image ships neither acl (setfacl, needed below) nor jq (needed by the
        # URL resolution above), so both are real installs here rather than the
        # no-op reinstalls the other two OSes get.
        if ! wb_zypper --gpg-auto-import-keys refresh; then
            log_error "Failed to refresh zypper repositories"
        fi
        if ! wb_zypper install --force-resolution acl jq curl sysvinit-tools; then
            log_error "Failed to install required packages (acl, jq, curl, sysvinit-tools)"
        fi
        ;;
    *)
        if ! sudo apt-get update; then
            log_error "Failed to update package lists"
        fi
        if ! sudo add-apt-repository -y universe; then
            log_error "Failed to add universe repository"
        fi
        if ! sudo apt-get update; then
            log_error "Failed to update package lists after adding universe"
        fi
        if ! sudo apt-get install -y acl jq curl; then
            log_error "Failed to install required packages (acl, jq, curl)"
        fi
        ;;
esac

# Now we can fetch the WB_URL if it wasn't provided
if [ -z "${WB_URL}" ]; then
    if [ "$CI_STABLE_MODE" = true ]; then
        echo "CI Stable Mode: Fetching latest released Workbench URL for ${WB_OS}/${ARCH_SUFFIX}..."
        # Get the directory where this script is located
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        WB_URL=$("${SCRIPT_DIR}/get-latest-wb-url.sh" "${WB_OS}" "${ARCH_SUFFIX}")
        if [ $? -ne 0 ] || [ -z "${WB_URL}" ]; then
            log_error "Failed to fetch released Workbench URL from get-latest-wb-url.sh"
        fi
        echo "Using released Workbench URL: ${WB_URL}"
    else
        echo "No WB_URL provided, fetching latest daily Workbench URL for ${WB_OS}/${ARCH_SUFFIX}..."
        WB_URL=$(wb_resolve_daily_url "${WB_OS}" "${ARCH_SUFFIX}")
        if [ $? -ne 0 ] || [ -z "${WB_URL}" ]; then
            log_error "Failed to resolve the latest daily Workbench URL for ${WB_OS}/${ARCH_SUFFIX}"
        fi
        echo "Using Workbench URL: ${WB_URL}"
    fi
else
    echo "Using provided Workbench URL: ${WB_URL}"
fi

# Log the configuration being used (but don't show the password)
echo "Using configuration:"
echo "  WB_URL: ${WB_URL}"
if [ -n "${POSITRON_TAG}" ]; then
    echo "  POSITRON_TAG: ${POSITRON_TAG}"
else
    echo "  POSITRON_TAG: [LATEST]"
fi
echo "  ARCH_SUFFIX: ${ARCH_SUFFIX}"
echo "  WB_OS: ${WB_OS}"
echo "  Q_USER: ${Q_USER}"
echo "  Q_UID: ${Q_UID}"
echo "  Q_GID: ${Q_GID}"
echo "  Q_GROUP: ${Q_GROUP}"
echo "  WB_PASSWORD: [HIDDEN]"
if [ -n "${CREDENTIALS}" ]; then
    echo "  CREDENTIALS: ${CREDENTIALS}"
else
    echo "  CREDENTIALS: [none]"
fi

# Create the user (skip if already exists)
echo "Creating user ${Q_USER}..."
if ! getent group ${Q_GROUP} > /dev/null 2>&1; then
    sudo groupadd -g ${Q_GID} ${Q_GROUP}
else
    echo "  Group ${Q_GROUP} already exists, skipping..."
fi
if ! id -u ${Q_USER} > /dev/null 2>&1; then
    sudo useradd --create-home --shell /bin/bash --home-dir /home/${Q_USER} -u ${Q_UID} -g ${Q_GROUP} ${Q_USER}
else
    echo "  User ${Q_USER} already exists, skipping..."
fi
echo "${Q_USER}":"${WB_PASSWORD}" | sudo chpasswd

echo "Configuring ~/.Renviron for ${Q_USER}..."
sudo mkdir -p "/home/${Q_USER}"
sudo tee "/home/${Q_USER}/.Renviron" >/dev/null <<EOF
R_LIBS_SITE=/usr/local/lib/R/site-library
R_LIBS_USER=/usr/local/lib/R/site-library
EOF
sudo chown "${Q_USER}:${Q_GROUP}" "/home/${Q_USER}/.Renviron"

# Configure RStudio
echo "Configuring RStudio..."
sudo mkdir -p /etc/rstudio
echo "unprivileged=1" | sudo tee /etc/rstudio/launcher.local.conf > /dev/null

# Download Workbench
echo "Downloading Workbench..."
if ! curl -fL ${WB_URL} --output "workbench.${WB_PKG_EXT}"; then
    log_error "Failed to download Workbench from ${WB_URL}"
fi

# Install Workbench
echo "Installing Workbench..."
case "${WB_FAMILY}" in
    redhat)
        if ! sudo dnf install -y "./workbench.${WB_PKG_EXT}"; then
            log_error "Failed to install Workbench package"
        fi
        ;;
    suse)
        # --allow-unsigned-rpm because the downloaded package carries no key this
        # container trusts, and --no-gpg-checks so resolving its dependencies out
        # of the image's repos does not stop on the same question. `zypper
        # install <path>`, not `rpm -i`, so those dependencies get pulled rather
        # than reported as unmet.
        if ! wb_zypper --no-gpg-checks install --allow-unsigned-rpm "./workbench.${WB_PKG_EXT}"; then
            log_error "Failed to install Workbench package"
        fi
        ;;
    *)
        if ! sudo apt install -y "./workbench.${WB_PKG_EXT}"; then
            log_error "Failed to install Workbench package"
        fi
        ;;
esac

if [ "${WB_FAMILY}" != "debian" ]; then
    # Both rpm packages' postinst installs systemd units, so /etc/init.d stays
    # empty and `rstudio-server start` has nothing to run. Each package also
    # ships the SysV scripts the Ubuntu .deb installs for us, in a directory
    # named for the family (verified: extras/init.d/{debian,redhat,suse} all
    # exist); copy those into place so the start/stop paths below (and
    # wb_ensure_workbench) work on every OS.
    INIT_SRC="/usr/lib/rstudio-server/extras/init.d/${WB_FAMILY}"
    if [ -d "${INIT_SRC}" ]; then
        sudo cp "${INIT_SRC}/rstudio-server" /etc/init.d/
        sudo cp "${INIT_SRC}/rstudio-launcher" /etc/init.d/
        sudo chmod +x /etc/init.d/rstudio-server /etc/init.d/rstudio-launcher
    else
        log_error "Workbench rpm did not ship ${INIT_SRC} (no SysV scripts to install)"
    fi
    # Without this the launcher warns that HOME is unset and that plugins may
    # inherit an incorrect one.
    sudo mkdir -p /home/rstudio-server
    sudo chown rstudio-server:rstudio-server /home/rstudio-server

    # Give PAM sessions a PATH that includes /usr/local/bin.
    #
    # rserver launches sessions through PAM, which builds a fresh environment
    # rather than inheriting the container's -- so the image's `ENV PATH` never
    # reaches a session, and putting a directory on PATH in the Dockerfile does
    # not help. `pam_env` (/etc/pam.d/system-auth on EL9, /etc/pam.d/common-session
    # on openSUSE) reads /etc/environment for that PATH; Debian/Ubuntu ship a
    # populated one and neither rpm distro does. The result on Rocky was a
    # session PATH without
    # /usr/local/bin, which is where the image installs quarto -- so Posit
    # Publisher's `quarto inspect` (spawned by name) failed, it fell back to a
    # hardcoded version with no engines, and Connect then declined to provision R
    # for the render and died with "Failed to spawn 'Rscript'".
    #
    # Only written when PATH is absent, so a future image that sets its own is
    # left alone.
    if ! sudo grep -q '^PATH=' /etc/environment 2>/dev/null; then
        printf 'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n' \
            | sudo tee -a /etc/environment > /dev/null
        sudo chmod 644 /etc/environment
    fi
fi

# Copy and configure Workbench license if present
if [ -f "/tmp/workbench.lic" ]; then
    echo "Configuring Workbench license..."
    sudo mkdir -p /var/lib/rstudio-server
    sudo cp /tmp/workbench.lic /var/lib/rstudio-server/workbench.lic
    # By name, not 999:999 -- that uid is Ubuntu's; the rpm picks a different one
    # (995 on Rocky 9), so the numeric form silently mis-owned the license there.
    sudo chown rstudio-server:rstudio-server /var/lib/rstudio-server/workbench.lic
    sudo chmod 0600 /var/lib/rstudio-server/workbench.lic
    echo "Workbench license configured"
else
    echo "No Workbench license file found at /tmp/workbench.lic - skipping license configuration"
fi

# Set access permissions
echo "Setting access permissions..."
sudo setfacl -m u:${Q_USER}:x /root
sudo setfacl -R -m u:${Q_USER}:rx /root/.venv /root/.pyenv
sudo setfacl -R -m d:u:${Q_USER}:rx /root/.venv /root/.pyenv

# Update positron-server
echo "Updating positron-server..."
stop_rserver

cd /usr/lib/rstudio-server/bin/

# Check if positron-server/bundled exists
if [ -d "positron-server/bundled" ]; then
    echo "Found positron-server/bundled directory - extracting to positron-server/new..."

    # Remove existing new directory if it exists
    if [ -d "positron-server/new" ]; then
        echo "Removing existing positron-server/new directory..."
        sudo rm -rf positron-server/new
    fi

    # Create the new directory
    if ! sudo mkdir -p positron-server/new; then
        log_error "Failed to create positron-server/new directory"
    fi

    cd positron-server/new
else
    echo "No bundled directory found - using legacy extraction method..."

    # Clean up any existing backup and move current version
    if [ -d "positron-server-old" ]; then
        echo "Removing existing positron-server-old backup..."
        sudo rm -rf positron-server-old
    fi

    if [ -d "positron-server" ]; then
        if ! sudo mv positron-server positron-server-old; then
            log_error "Failed to backup existing positron-server"
        fi
    fi

    if ! sudo mkdir -p positron-server; then
        log_error "Failed to create new positron-server directory"
    fi

    cd positron-server
fi

# Run download script
if [ -n "${POSITRON_TAG}" ]; then
    echo "Running download script with TAG=${POSITRON_TAG}, ARCH_SUFFIX=${ARCH_SUFFIX}, GITHUB_TOKEN=***..."
else
    echo "Running download script with latest Positron release, ARCH_SUFFIX=${ARCH_SUFFIX}, GITHUB_TOKEN=***..."
fi
if ! TAG=${POSITRON_TAG} ARCH_SUFFIX=${ARCH_SUFFIX} GITHUB_TOKEN=${GITHUB_TOKEN} /tmp/positronDownload.sh; then
    log_error "Failed to download/install Positron"
fi

# Configure data sources (one credential type: databricks, snowflake, or azure)
CREDENTIALS_OK=false
if [ -n "${CREDENTIALS}" ]; then
    echo "Configuring data source: ${CREDENTIALS}..."
    # Clear any marker from a previous run before attempting this one, so a
    # failed attempt here can never leave behind a stale success marker.
    rm -f /var/lib/wb-local-credentials 2>/dev/null || true
    if [ -f "/tmp/configure-datasources.sh" ]; then
        if /tmp/configure-datasources.sh "${CREDENTIALS}"; then
            CREDENTIALS_OK=true
            # Record success so a later 'npm run pwb -- status' can show it too.
            printf '%s\n' "${CREDENTIALS}" > /var/lib/wb-local-credentials 2>/dev/null || true
        else
            log_error "Failed to configure data source: ${CREDENTIALS}"
        fi
    else
        echo "Skipping data source configuration (configure-datasources.sh not found)"
    fi
else
    echo "No --credentials specified - skipping data source configuration"
fi

# Start the launcher (Rocky only) and RStudio server
echo "Starting RStudio server..."
start_workbench

# Ensure (fetch once) + export CONNECT_TOKEN for subsequent steps/tests
ensure_connect_token || true

# Setup environment modules. The Ubuntu and Rocky images bake the package in, so
# there this is a no-op reinstall (and a safety net for an image that predates
# it). The openSUSE image does not ship it, so there it is a real install --
# worth adding to that image's package list eventually, but it costs seconds and
# keeping it here means the lane does not wait on an image rebuild.
echo "Setting up environment modules..."
case "${WB_FAMILY}" in
    redhat)
        if ! sudo dnf install -y environment-modules; then
            log_error "Failed to install environment-modules"
        fi
        ;;
    suse)
        # openSUSE names the same project's package "Modules", not
        # "environment-modules". It drops the same /etc/profile.d/modules.sh the
        # other two do, which is what the profile.d snippet below sources.
        if ! wb_zypper install Modules; then
            log_error "Failed to install Modules (environment-modules)"
        fi
        ;;
    *)
        if ! sudo apt install -y environment-modules; then
            log_error "Failed to install environment-modules"
        fi
        ;;
esac
# The session user (not root) resolves these modulefiles, so the tree has to be
# world-readable. State the modes rather than inheriting the ambient umask: a
# sourced helper leaking `umask 077` once made these 0700/0600, which hid both
# module environments from the session and failed the @:environment-modules
# tests while the install still reported success.
if ! sudo install -d -m 755 /opt/modules/modulefiles/R; then
    log_error "Failed to create /opt/modules/modulefiles/R directory"
fi
printf '#%%Module1.0\nset root /root/scratch/R-4.4.1\nprepend-path PATH $root/bin\nprepend-path MANPATH $root/share/man\nsetenv R_HOME $root/lib/R\n' | sudo tee /opt/modules/modulefiles/R/4.4.1 > /dev/null
sudo chmod 644 /opt/modules/modulefiles/R/4.4.1
if ! sudo install -d -m 755 /opt/modules/modulefiles/python; then
    log_error "Failed to create /opt/modules/modulefiles/python directory"
fi
printf '#%%Module1.0\nset root /root/scratch/python-env\nprepend-path PATH $root/bin\n' | sudo tee /opt/modules/modulefiles/python/3.12.10 > /dev/null
sudo chmod 644 /opt/modules/modulefiles/python/3.12.10
# Put the module setup on /etc/profile.d rather than in a user dotfile. This
# used to append to ~/.profile, which is a Debian-ism: bash reads ~/.profile only
# when ~/.bash_profile and ~/.bash_login are both absent, and EL9's /etc/skel
# ships a ~/.bash_profile. So on Rocky the appends were never read, MODULEPATH
# never gained /opt/modules/modulefiles, and both @:environment-modules tests
# failed with an empty module picker. A profile.d drop-in is read by login shells
# on both OSes and needs no per-user ownership fixing.
printf 'source /etc/profile.d/modules.sh\nmodule use /opt/modules/modulefiles\n' \
    | sudo tee /etc/profile.d/positron-modules.sh > /dev/null
sudo chmod 644 /etc/profile.d/positron-modules.sh

# Also cover interactive non-login shells, which read ~/.bashrc and not
# profile.d. Idempotent: --reinstall re-runs this, and the @:environment-modules
# test appends the same two lines itself if they are missing.
if ! sudo grep -q 'module use /opt/modules/modulefiles' /home/${Q_USER}/.bashrc 2>/dev/null; then
    printf 'source /etc/profile.d/modules.sh\nmodule use /opt/modules/modulefiles\n' \
        | sudo tee -a /home/${Q_USER}/.bashrc > /dev/null
fi
sudo chown ${Q_USER}:${Q_GROUP} /home/${Q_USER}/.bashrc
sudo chmod 644 /home/${Q_USER}/.bashrc

# Log completion and versions
echo ""
echo "Installation complete 🎉"

# Extract Workbench version - just get the first word from "2025.11.0-daily+151.pro2 Workbench..."
WB_VERSION=$(sudo rstudio-server version 2>/dev/null | head -1 | awk '{print $1}')

# Extract Positron version and build number, combine them
# Check if we extracted to the 'new' directory (when bundled exists) or directly to positron-server
if [ -d "/usr/lib/rstudio-server/bin/positron-server/new" ]; then
    POSITRON_DIR="/usr/lib/rstudio-server/bin/positron-server/new"
else
    POSITRON_DIR="/usr/lib/rstudio-server/bin/positron-server"
fi

POSITRON_VERSION=$(cd "${POSITRON_DIR}" && grep '"positronVersion"' product.json 2>/dev/null | sed 's/.*"positronVersion": *"\([^"]*\)".*/\1/' || echo "Unknown")
POSITRON_BUILD=$(cd "${POSITRON_DIR}" && grep '"positronBuildNumber"' product.json 2>/dev/null | sed 's/.*"positronBuildNumber": *"\([^"]*\)".*/\1/' || echo "")
POSITRON_FULL_VERSION="${POSITRON_VERSION}-${POSITRON_BUILD}"

echo "Positron version:    ${POSITRON_FULL_VERSION}"
echo "Workbench version:   ${WB_VERSION}"
if [ "${CREDENTIALS_OK}" = true ]; then
    echo "Credentials:         ${CREDENTIALS}"
fi
echo "Workbench URL:       http://localhost:8787"

# Report any errors that occurred
if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  WARNING: ${#ERRORS[@]} error(s) occurred during installation:"
    for error in "${ERRORS[@]}"; do
        echo "   • $error"
    done
    echo ""
    echo "Installation may not be fully functional. Check logs above for details."
fi
echo ""
