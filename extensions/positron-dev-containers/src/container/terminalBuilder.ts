/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as jsonc from 'jsonc-parser';
import { getLogger } from '../common/logger';

/**
 * Result from terminal build
 */
export interface TerminalBuildResult {
	containerId: string;
	containerName: string;
	remoteWorkspaceFolder: string;
	terminal: vscode.Terminal;
}

/**
 * Builds and runs dev containers using actual docker commands in a terminal
 */
export class TerminalBuilder {
	/**
	 * Build and create a dev container in a terminal
	 */
	static async buildAndCreate(
		workspaceFolder: string,
		rebuild: boolean,
		noCache: boolean
	): Promise<TerminalBuildResult> {
		const logger = getLogger();

		// Find the devcontainer.json file
		const devcontainerPath = path.join(workspaceFolder, '.devcontainer', 'devcontainer.json');
		if (!fs.existsSync(devcontainerPath)) {
			throw new Error(`Dev container configuration not found: ${devcontainerPath}`);
		}

		// Read and parse the devcontainer.json (supports comments via JSONC)
		const config = jsonc.parse(fs.readFileSync(devcontainerPath, 'utf8'));

		// Determine the Dockerfile or image
		const devcontainerDir = path.dirname(devcontainerPath);
		let dockerfilePath: string | undefined;
		let imageName: string | undefined;

		if (config.build && config.build.dockerfile) {
			dockerfilePath = path.join(devcontainerDir, config.build.dockerfile);
		} else if (config.dockerFile) {
			dockerfilePath = path.join(devcontainerDir, config.dockerFile);
		} else if (config.image) {
			imageName = config.image;
		} else {
			// Default to Dockerfile in .devcontainer directory
			const defaultDockerfile = path.join(devcontainerDir, 'Dockerfile');
			if (fs.existsSync(defaultDockerfile)) {
				dockerfilePath = defaultDockerfile;
			}
		}

		// Generate container name
		const folderName = path.basename(workspaceFolder);
		const containerName = `devcontainer-${folderName}-${Date.now()}`;
		const remoteWorkspaceFolder = `/workspaces/${folderName}`;

		// Build the image name
		let builtImageName: string;
		if (dockerfilePath) {
			builtImageName = `vsc-${folderName}-${Date.now()}`.toLowerCase();
		} else if (imageName) {
			builtImageName = imageName;
		} else {
			throw new Error('No Dockerfile or image specified in devcontainer.json');
		}

		// Create a temporary script file to run in the terminal
		const scriptPath = path.join(os.tmpdir(), `devcontainer-build-${Date.now()}.sh`);
		const markerPath = path.join(os.tmpdir(), `devcontainer-build-${Date.now()}.done`);
		const containerIdPath = path.join(os.tmpdir(), `devcontainer-build-${Date.now()}.id`);

		let scriptContent = '#!/bin/sh\nset -e\n\n';
		// Add error trap to keep terminal open on failure
		scriptContent += '# Trap errors to keep terminal open so user can see what failed\n';
		scriptContent += 'trap \'echo ""; echo "==> ERROR: Build failed! Press Enter to close this terminal..."; read dummy\' ERR\n\n';

		// Remove existing container if rebuild
		if (rebuild) {
			scriptContent += 'echo "==> Removing existing containers..."\n';
			scriptContent += `docker ps -a -q --filter "name=${folderName}" | xargs docker rm -f 2>/dev/null || true\n\n`;
		}

		// Build image if needed
		if (dockerfilePath) {
			const buildContext = config.build?.context ? path.join(devcontainerDir, config.build.context) : devcontainerDir;
			scriptContent += 'echo "==> Building dev container image..."\n';
			scriptContent += `docker build -t ${builtImageName}`;
			if (noCache) {
				scriptContent += ' --no-cache';
			}
			if (config.build?.args) {
				for (const [key, value] of Object.entries(config.build.args)) {
					scriptContent += ` --build-arg ${key}=${value}`;
				}
			}
			scriptContent += ` -f "${dockerfilePath}" "${buildContext}"\n\n`;
		} else {
			scriptContent += `echo "==> Using image: ${imageName}"\n\n`;
		}

		// Create container
		scriptContent += 'echo "==> Creating container..."\n';
		scriptContent += `docker create --name ${containerName}`;
		scriptContent += ` --label devcontainer.local_folder="${workspaceFolder}"`;
		scriptContent += ` --label devcontainer.config_file="${devcontainerPath}"`;
		scriptContent += ` -v "${workspaceFolder}:${remoteWorkspaceFolder}"`;

		// Add mounts from config
		if (config.mounts) {
			for (const mount of config.mounts) {
				scriptContent += ` --mount ${mount}`;
			}
		}

		scriptContent += ` -w ${remoteWorkspaceFolder}`;

		// Add remote user
		if (config.remoteUser) {
			scriptContent += ` -u ${config.remoteUser}`;
		}

		// Add environment variables
		if (config.remoteEnv) {
			for (const [key, value] of Object.entries(config.remoteEnv)) {
				scriptContent += ` -e ${key}="${value}"`;
			}
		}

		scriptContent += ` ${builtImageName} sleep infinity\n\n`;

		// Start container
		scriptContent += 'echo "==> Starting container..."\n';
		scriptContent += `docker start ${containerName}\n\n`;

		// Run post-create command if specified
		if (config.postCreateCommand) {
			scriptContent += 'echo "==> Running post-create command..."\n';
			let postCreateCmd: string;
			if (typeof config.postCreateCommand === 'string') {
				postCreateCmd = config.postCreateCommand;
			} else if (Array.isArray(config.postCreateCommand)) {
				postCreateCmd = config.postCreateCommand.join(' ');
			} else {
				postCreateCmd = '';
			}
			if (postCreateCmd) {
				// Escape the command properly for the script
				const escapedCmd = postCreateCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
				// Allow command to fail gracefully - permission errors on bind-mounted .git files are common
				scriptContent += `docker exec ${containerName} sh -c "${escapedCmd}" || echo "Note: Post-create command had non-fatal errors (this is common with bind-mounted .git directories)"\n\n`;
			}
		}

		// Get and save container ID
		scriptContent += 'echo "==> Getting container ID..."\n';
		scriptContent += `docker inspect -f '{{.Id}}' ${containerName} > "${containerIdPath}"\n\n`;

		// Write marker file to indicate completion
		scriptContent += 'echo "==> Container ready!"\n';
		scriptContent += `echo "done" > "${markerPath}"\n`;
		// Disable error trap since build succeeded
		scriptContent += 'trap - ERR\n';

		// Write the script file
		fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

		logger.info(`Created build script: ${scriptPath}`);

		// Create terminal and run the script
		const terminal = vscode.window.createTerminal({
			name: 'Dev Container Build',
			iconPath: new vscode.ThemeIcon('debug-console')
		});
		terminal.show();

		// Execute the script in the terminal (using source to hide the filename)
		terminal.sendText(`source "${scriptPath}"`, true);

		// Wait for the marker file to appear
		logger.info('Waiting for container build to complete...');
		const startTime = Date.now();
		const timeout = 10 * 60 * 1000; // 10 minutes

		while (true) {
			if (fs.existsSync(markerPath)) {
				break;
			}

			if (Date.now() - startTime > timeout) {
				// Clean up
				try {
					fs.unlinkSync(scriptPath);
				} catch { }
				throw new Error('Container build timed out after 10 minutes');
			}

			// Wait a bit before checking again
			await new Promise(resolve => setTimeout(resolve, 500));
		}

		// Read the container ID
		let containerId: string;
		try {
			containerId = fs.readFileSync(containerIdPath, 'utf8').trim();
			logger.info(`Container created: ${containerId}`);
		} catch (error) {
			throw new Error(`Failed to read container ID: ${error}`);
		} finally {
			// Clean up temporary files
			try {
				fs.unlinkSync(scriptPath);
				fs.unlinkSync(markerPath);
				fs.unlinkSync(containerIdPath);
			} catch { }
		}

		return {
			terminal,
			containerId,
			containerName,
			remoteWorkspaceFolder
		};
	}
}
