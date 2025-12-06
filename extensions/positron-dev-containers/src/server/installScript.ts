/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServerConfig } from './serverConfig';

/**
 * Options for generating the installation script
 */
export interface InstallScriptOptions {
	/**
	 * Server configuration
	 */
	serverConfig: ServerConfig;

	/**
	 * Connection token for authentication
	 */
	connectionToken: string;

	/**
	 * Port to listen on (0 for random port)
	 */
	port?: number;

	/**
	 * Use socket instead of port
	 */
	useSocket?: boolean;

	/**
	 * Socket path (if useSocket is true)
	 */
	socketPath?: string;

	/**
	 * Additional extensions to install
	 */
	extensions?: string[];

	/**
	 * Additional server arguments
	 */
	additionalArgs?: string[];

	/**
	 * Skip server start (just install)
	 */
	skipStart?: boolean;

	/**
	 * Environment variables to set for the server process
	 */
	extensionHostEnv?: { [key: string]: string };
}

/**
 * Generate installation script for the Positron server
 * This script will be executed inside the container to:
 * 1. Download the Positron server tarball
 * 2. Extract it to the appropriate location
 * 3. Start the server with the correct arguments
 * 4. Output connection information
 *
 * @param options Installation options
 * @returns Bash script as a string
 */
export function generateInstallScript(options: InstallScriptOptions): string {
	const {
		serverConfig,
		skipStart = false
	} = options;

	const installDir = `~/.positron-server/${serverConfig.serverDirName}`;
	const dataDir = '~/.positron-server/data';
	const extensionsDir = '~/.positron-server/extensions';

	// Build the script
	const script = `#!/bin/sh
set -e

# Positron Server Installation Script
# Generated for commit: ${serverConfig.commit}
# Platform: ${serverConfig.platform.platformString}

# Output format markers
MARKER_START="__POSITRON_SERVER_START__"
MARKER_END="__POSITRON_SERVER_END__"

# Log function
log() {
	echo "[positron-server] $*" >&2
}

# Error function
error() {
	echo "[positron-server] ERROR: $*" >&2
	exit 1
}

log "Starting Positron server installation..."

# Define installation paths
INSTALL_DIR="${installDir.replace(/^~/, '$HOME')}"
DATA_DIR="${dataDir.replace(/^~/, '$HOME')}"
EXTENSIONS_DIR="${extensionsDir.replace(/^~/, '$HOME')}"
SERVER_BINARY="\${INSTALL_DIR}/bin/positron-server"

# Check if server is already installed
if [ -f "\${SERVER_BINARY}" ]; then
	log "Server already installed at \${INSTALL_DIR}"
else
	log "Installing server to \${INSTALL_DIR}"

	# Create installation directory
	mkdir -p "\${INSTALL_DIR}"
	cd "\${INSTALL_DIR}"

	# Detect download tool
	if command -v wget >/dev/null 2>&1; then
		DOWNLOAD_TOOL="wget"
		DOWNLOAD_CMD="wget -q -O -"
	elif command -v curl >/dev/null 2>&1; then
		DOWNLOAD_TOOL="curl"
		DOWNLOAD_CMD="curl -fsSL"
	else
		error "Neither wget nor curl found. Please install one of them."
	fi

	log "Downloading and installing server..."

	# Download and extract server
	DOWNLOAD_URL="${serverConfig.downloadUrl}"

	log "Attempting to download from: \${DOWNLOAD_URL}"

	# Try to download and extract, capturing detailed error information
	if [ "\${DOWNLOAD_TOOL}" = "wget" ]; then
		# wget provides better error messages with -S (show headers)
		# Redirect stderr to log file while keeping stdout clean for tar
		if ! wget -S -O - "\${DOWNLOAD_URL}" 2>/tmp/download.log | tar -xz -C "\${INSTALL_DIR}" --strip-components=1 2>&1; then
			# Extract HTTP status from wget output
			HTTP_STATUS=\$(grep -i "HTTP/" /tmp/download.log | tail -n1 | sed 's/.*HTTP\\/[^ ]* \\([0-9]*\\).*/\\1/' || echo "unknown")
			case "\${HTTP_STATUS}" in
				404)
					error "File not found (HTTP 404): \${DOWNLOAD_URL}. This version may not be available yet or the URL may be incorrect."
					;;
				403)
					error "Access forbidden (HTTP 403): \${DOWNLOAD_URL}. Check if the URL requires authentication or if access is restricted."
					;;
				5*)
					error "Server error (HTTP \${HTTP_STATUS}): \${DOWNLOAD_URL}. The download server may be experiencing issues. Try again later."
					;;
				*)
					log "Download or extraction failed. Last wget output:"
					tail -10 /tmp/download.log >&2 || true
					error "Failed to download or extract server from \${DOWNLOAD_URL} (HTTP status: \${HTTP_STATUS})"
					;;
			esac
		fi
	elif [ "\${DOWNLOAD_TOOL}" = "curl" ]; then
		# curl with -v for verbose error information
		HTTP_CODE=\$(curl -w "%{http_code}" -fsSL "\${DOWNLOAD_URL}" 2>/tmp/curl.err | tee /tmp/download.tar.gz | tar -xz -C "\${INSTALL_DIR}" --strip-components=1 2>&1 || echo "000")
		if [ "\${HTTP_CODE}" != "200" ] && [ "\${HTTP_CODE}" != "000" ]; then
			case "\${HTTP_CODE}" in
				404)
					error "File not found (HTTP 404): \${DOWNLOAD_URL}. This version may not be available yet or the URL may be incorrect."
					;;
				403)
					error "Access forbidden (HTTP 403): \${DOWNLOAD_URL}. Check if the URL requires authentication or if access is restricted."
					;;
				5*)
					error "Server error (HTTP \${HTTP_CODE}): \${DOWNLOAD_URL}. The download server may be experiencing issues. Try again later."
					;;
				000)
					log "Curl error output:"
					cat /tmp/curl.err >&2 || true
					error "Failed to connect or download from \${DOWNLOAD_URL}. Check network connectivity and URL."
					;;
				*)
					log "Unexpected HTTP status. Curl error output:"
					cat /tmp/curl.err >&2 || true
					error "Failed to download server from \${DOWNLOAD_URL} (HTTP status: \${HTTP_CODE})"
					;;
			esac
		fi
	fi

	# Verify installation
	if [ ! -f "\${SERVER_BINARY}" ]; then
		error "Server binary not found after extraction: \${SERVER_BINARY}"
	fi

	log "Server installed successfully"
fi

# Create data and extensions directories
mkdir -p "\${DATA_DIR}"
mkdir -p "\${EXTENSIONS_DIR}"

# Make server binary executable
chmod +x "\${SERVER_BINARY}"

# Verify Node.js binary compatibility
NODE_BINARY="\${INSTALL_DIR}/node"
if [ ! -f "\${NODE_BINARY}" ]; then
	error "Node.js binary not found: \${NODE_BINARY}. The server archive may be incomplete."
fi

# Check if the Node.js binary can execute
if ! "\${NODE_BINARY}" --version >/dev/null 2>&1; then
	log "WARNING: Node.js binary cannot execute. This may indicate a libc compatibility issue."

	# Try to detect Alpine/musl
	if [ -f /etc/alpine-release ]; then
		log "Alpine Linux detected. Attempting to install glibc compatibility layer..."

		# Try to install gcompat (glibc compatibility for musl)
		if command -v apk >/dev/null 2>&1; then
			log "Installing gcompat package..."

			# Try with different permission escalation methods
			INSTALL_CMD=""
			if apk add --no-cache gcompat >/dev/null 2>&1; then
				INSTALL_CMD="success"
			elif command -v sudo >/dev/null 2>&1 && sudo -n apk add --no-cache gcompat >/dev/null 2>&1; then
				INSTALL_CMD="success"
			elif command -v doas >/dev/null 2>&1 && doas apk add --no-cache gcompat >/dev/null 2>&1; then
				INSTALL_CMD="success"
			fi

			if [ "\${INSTALL_CMD}" = "success" ]; then
				log "gcompat installed successfully. Retrying Node.js binary..."
				if "\${NODE_BINARY}" --version >/dev/null 2>&1; then
					log "Node.js binary now works with gcompat!"
				else
					error "Node.js binary still cannot execute even with gcompat. You may need to use a Debian/Ubuntu-based container image instead of Alpine."
				fi
			else
				error "Failed to install gcompat (permission denied or package unavailable). Try: 1) Run 'apk add gcompat' as root in your container, or 2) Add 'gcompat' to your Dockerfile, or 3) Use a Debian/Ubuntu-based container instead of Alpine."
			fi
		else
			error "Alpine Linux detected but apk not available. Cannot install gcompat automatically. Please use a glibc-based container (e.g., Debian, Ubuntu)."
		fi
	else
		# Check what libc is being used
		if command -v ldd >/dev/null 2>&1; then
			log "Checking Node.js binary dependencies:"
			ldd "\${NODE_BINARY}" >&2 || true
		fi

		error "Node.js binary is incompatible with this container. This usually means the container uses musl libc instead of glibc. Please use a glibc-based container image (e.g., Debian, Ubuntu)."
	fi
fi

log "Node.js binary verified: \$(\${NODE_BINARY} --version)"

${skipStart ? '# Skipping server start as requested' : generateServerStartScript(options, extensionsDir)}

log "Installation script completed"
`;

	return script;
}

/**
 * Generate the server start portion of the script
 */
function generateServerStartScript(options: InstallScriptOptions, extensionsDir: string): string {
	const {
		connectionToken,
		port,
		useSocket,
		socketPath,
		extensions = [],
		additionalArgs = [],
		extensionHostEnv = {}
	} = options;

	const expandedExtensionsDir = extensionsDir.replace(/^~/, '$HOME');

	// Determine socket path or port
	const defaultSocketPath = '$DATA_DIR/positron-server.sock';
	const actualSocketPath = socketPath || defaultSocketPath;
	const actualPort = port !== undefined ? port : 0;

	const serverArgs = [
		'--accept-server-license-terms',
		`--connection-token="${connectionToken}"`,
		`--user-data-dir="\${DATA_DIR}"`,
		`--extensions-dir="${expandedExtensionsDir}"`
	];

	// Add listen configuration
	if (useSocket) {
		serverArgs.push(`--socket-path="${actualSocketPath}"`);
	} else {
		// Use port 0 if not specified (OS will pick a random available port)
		serverArgs.push(`--port=${actualPort}`);
	}

	// Add extension installation commands
	const extensionInstallCommands = extensions.map(ext =>
		`	log "Installing extension: ${ext}"\n` +
		`	"\${SERVER_BINARY}" --install-extension "${ext}" --extensions-dir="${expandedExtensionsDir}" || log "Warning: Failed to install extension ${ext}"`
	).join('\n');

	// Add additional arguments
	if (additionalArgs.length > 0) {
		serverArgs.push(...additionalArgs.map(arg => `"${arg}"`));
	}

	return `# Install extensions if requested
${extensionInstallCommands ? extensionInstallCommands + '\n' : ''}
# Start the server
log "Starting Positron server..."
log "Server binary: \${SERVER_BINARY}"
log "Connection token: [REDACTED]"
${useSocket ? `log "Socket path: ${actualSocketPath}"` : `log "Port: ${actualPort} (0 = random port)"`}

# Output marker for parsing
echo "\${MARKER_START}"

# Create a log file for server output
SERVER_LOG="\${DATA_DIR}/server.log"
touch "\${SERVER_LOG}"

# Start server and capture output to log file
# The server will print its listening information
# Set environment variables for the server process
${Object.entries(extensionHostEnv).map(([key, value]) => `${key}="${value}"`).join(' ')} "\${SERVER_BINARY}" ${serverArgs.join(' ')} > "\${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

log "Server started with PID: \${SERVER_PID}"
log "Server output is being written to: \${SERVER_LOG}"

# Wait for server to output its listening information
# The server typically outputs a line like:
#   "Extension host agent listening on port 12345"
#   or "Extension host agent listening on /tmp/socket.sock"

# Give the server time to start and output its info
sleep 2

# Check if server is still running
if ! kill -0 \${SERVER_PID} 2>/dev/null; then
	log "ERROR: Server process terminated unexpectedly"
	log "Server log contents:"
	cat "\${SERVER_LOG}" >&2
	error "Server process terminated unexpectedly. Check the logs above for details."
fi

# Determine the actual listening address
${useSocket ? `
ACTUAL_LISTENING="${actualSocketPath}"
` : `
# Parse the server log to find the actual port (in case we used port 0)
# Use sed instead of grep -P for better portability (works with busybox)
ACTUAL_PORT=\$(sed -n 's/.*Extension host agent listening on \\([0-9][0-9]*\\).*/\\1/p' "\${SERVER_LOG}" | head -n1)
if [ -z "\${ACTUAL_PORT}" ]; then
	# Fallback: try other patterns
	ACTUAL_PORT=\$(sed -n 's/.*listening on.*port \\([0-9][0-9]*\\).*/\\1/p' "\${SERVER_LOG}" | head -n1)
fi
if [ -z "\${ACTUAL_PORT}" ]; then
	# Last resort: use the original port value
	ACTUAL_PORT="${actualPort}"
fi
ACTUAL_LISTENING="\${ACTUAL_PORT}"
`}

log "Server is listening on: \${ACTUAL_LISTENING}"

# Output connection information
echo "listeningOn=\${ACTUAL_LISTENING}"
echo "connectionToken=${connectionToken}"
echo "serverPid=\${SERVER_PID}"
echo "exitCode=0"

echo "\${MARKER_END}"

# Don't wait for the server - let it run in the background
# The docker exec will exit and the server will continue running in the container
# The server process is now running independently
`;
}

/**
 * Parse the output from the installation script
 * Extracts connection information from the script output
 *
 * @param output Script output
 * @returns Parsed connection information
 */
export interface InstallScriptOutput {
	/**
	 * Port or socket path the server is listening on
	 */
	listeningOn: string;

	/**
	 * Connection token
	 */
	connectionToken: string;

	/**
	 * Server process ID
	 */
	serverPid: string;

	/**
	 * Exit code
	 */
	exitCode: number;

	/**
	 * Full output
	 */
	fullOutput: string;
}

/**
 * Parse installation script output
 */
export function parseInstallScriptOutput(output: string): InstallScriptOutput | undefined {
	// Look for the marker section
	const markerStart = '__POSITRON_SERVER_START__';
	const markerEnd = '__POSITRON_SERVER_END__';

	const startIndex = output.indexOf(markerStart);
	const endIndex = output.indexOf(markerEnd);

	if (startIndex === -1 || endIndex === -1) {
		return undefined;
	}

	// Extract the section between markers
	const markedOutput = output.substring(startIndex + markerStart.length, endIndex).trim();

	// Parse key-value pairs
	const result: Partial<InstallScriptOutput> = {
		fullOutput: output
	};

	const lines = markedOutput.split('\n');
	for (const line of lines) {
		const [key, value] = line.split('=', 2);
		if (key && value) {
			switch (key.trim()) {
				case 'listeningOn':
					result.listeningOn = value.trim();
					break;
				case 'connectionToken':
					result.connectionToken = value.trim();
					break;
				case 'serverPid':
					result.serverPid = value.trim();
					break;
				case 'exitCode':
					result.exitCode = parseInt(value.trim(), 10);
					break;
			}
		}
	}

	// Validate required fields
	if (result.listeningOn && result.connectionToken && result.exitCode !== undefined) {
		return result as InstallScriptOutput;
	}

	return undefined;
}
