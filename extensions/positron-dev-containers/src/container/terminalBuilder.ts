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
import { Configuration } from '../common/configuration';
import { generateDockerBuildCommand, generateDockerCreateCommand } from '../spec/spec-node/devContainersSpecCLI';
import { formatCommandWithEcho, escapeShellArg } from '../spec/spec-node/commandGeneration';

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
		const config = Configuration.getInstance();

		// Find the devcontainer.json file
		const devcontainerPath = path.join(workspaceFolder, '.devcontainer', 'devcontainer.json');
		if (!fs.existsSync(devcontainerPath)) {
			throw new Error(`Dev container configuration not found: ${devcontainerPath}`);
		}

		// Read and parse the devcontainer.json (supports comments via JSONC)
		const devContainerConfig = jsonc.parse(fs.readFileSync(devcontainerPath, 'utf8'));

		// Determine the Dockerfile or image
		const devcontainerDir = path.dirname(devcontainerPath);
		let dockerfilePath: string | undefined;
		let imageName: string | undefined;

		if (devContainerConfig.build && devContainerConfig.build.dockerfile) {
			dockerfilePath = path.join(devcontainerDir, devContainerConfig.build.dockerfile);
		} else if (devContainerConfig.dockerFile) {
			dockerfilePath = path.join(devcontainerDir, devContainerConfig.dockerFile);
		} else if (devContainerConfig.image) {
			imageName = devContainerConfig.image;
		} else {
			// Default to Dockerfile in .devcontainer directory
			const defaultDockerfile = path.join(devcontainerDir, 'Dockerfile');
			if (fs.existsSync(defaultDockerfile)) {
				dockerfilePath = defaultDockerfile;
			}
		}

		// Setup folder paths
		const folderName = path.basename(workspaceFolder);
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

		// Get settings from VS Code configuration
		const dockerPath = config.getDockerPath();
		const workspaceMountConsistency = config.getWorkspaceMountConsistency();

		// Create a temporary script file to run in the terminal
		const timestamp = Date.now();
		const scriptPath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.sh`);
		const markerPath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.done`);
		const containerIdPath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.id`);
		const containerNamePath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.name`);

		let scriptContent = '#!/bin/sh\nset -e\n\n';
		// Add error trap to keep terminal open on failure
		scriptContent += '# Trap errors to keep terminal open so user can see what failed\n';
		scriptContent += 'trap \'echo ""; echo "==> ERROR: Build failed! Press Enter to close this terminal..."; read dummy\' ERR\n\n';

		// Remove existing container if rebuild
		if (rebuild) {
			scriptContent += 'echo "==> Removing existing containers..."\n';
			scriptContent += `${dockerPath} ps -a -q --filter "label=devcontainer.local_folder=${escapeShellArg(workspaceFolder)}" | xargs ${dockerPath} rm -f 2>/dev/null || true\n\n`;
		}

		// Generate build command using spec-node if we have a Dockerfile
		if (dockerfilePath) {
			const buildContext = devContainerConfig.build?.context ? path.join(devcontainerDir, devContainerConfig.build.context) : devcontainerDir;
			const buildCmd = await generateDockerBuildCommand({
				dockerPath,
				dockerfilePath,
				contextPath: buildContext,
				imageName: builtImageName,
				buildArgs: devContainerConfig.build?.args,
				target: devContainerConfig.build?.target,
				noCache,
				cacheFrom: devContainerConfig.build?.cacheFrom ?
					(Array.isArray(devContainerConfig.build.cacheFrom) ? devContainerConfig.build.cacheFrom : [devContainerConfig.build.cacheFrom]) :
					undefined,
				buildKitEnabled: config.getConfiguration().workspaceMountConsistency !== 'consistent', // Simple heuristic
				additionalArgs: devContainerConfig.build?.options,
			});
			scriptContent += formatCommandWithEcho(buildCmd) + '\n\n';
		} else {
			scriptContent += `echo "==> Using image: ${imageName}"\n\n`;
		}

		// Prepare mounts array
		const mounts: string[] = [];
		if (devContainerConfig.mounts) {
			for (const mount of devContainerConfig.mounts) {
				mounts.push(mount);
			}
		}

		// Add workspace mount consistency if specified
		if (workspaceMountConsistency && workspaceMountConsistency !== 'consistent') {
			// This is handled in the volume mount, not as a separate mount
		}

		// Generate container create command using spec-node
		const createCmd = await generateDockerCreateCommand({
			dockerPath,
			imageName: builtImageName,
			workspaceFolder,
			remoteWorkspaceFolder,
			containerUser: devContainerConfig.remoteUser,
			env: devContainerConfig.remoteEnv,
			mounts,
			labels: {
				'devcontainer.local_folder': workspaceFolder,
				'devcontainer.config_file': devcontainerPath,
			},
			runArgs: devContainerConfig.runArgs,
		});

		scriptContent += 'echo "==> Creating container..."\n';
		// Capture container ID from docker create
		scriptContent += `CONTAINER_ID=$(${dockerPath} ${createCmd.args.join(' ')})\n`;
		scriptContent += 'echo "Container ID: $CONTAINER_ID"\n\n';

		// Start container
		scriptContent += 'echo "==> Starting container..."\n';
		scriptContent += `${dockerPath} start $CONTAINER_ID\n\n`;

		// Run post-create command if specified
		if (devContainerConfig.postCreateCommand) {
			scriptContent += 'echo "==> Running post-create command..."\n';
			let postCreateCmd: string;
			if (typeof devContainerConfig.postCreateCommand === 'string') {
				postCreateCmd = devContainerConfig.postCreateCommand;
			} else if (Array.isArray(devContainerConfig.postCreateCommand)) {
				postCreateCmd = devContainerConfig.postCreateCommand.join(' ');
			} else {
				postCreateCmd = '';
			}
			if (postCreateCmd) {
				// Escape the command properly for the script
				const escapedCmd = postCreateCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
				// Allow command to fail gracefully - permission errors on bind-mounted .git files are common
				scriptContent += `${dockerPath} exec $CONTAINER_ID sh -c "${escapedCmd}" || echo "Note: Post-create command had non-fatal errors (this is common with bind-mounted .git directories)"\n\n`;
			}
		}

		// Save container ID and name
		scriptContent += 'echo "==> Saving container info..."\n';
		scriptContent += `echo "$CONTAINER_ID" > "${containerIdPath}"\n`;
		scriptContent += `${dockerPath} inspect -f '{{.Name}}' $CONTAINER_ID | sed 's/^\\///' > "${containerNamePath}"\n\n`;

		// Write marker file to indicate completion
		scriptContent += 'echo "==> Container ready!"\n';
		scriptContent += `echo "done" > "${markerPath}"\n`;
		// Disable error trap since build succeeded and exit cleanly
		scriptContent += 'trap - ERR\n';
		scriptContent += 'exit 0\n';

		// Write the script file
		fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

		logger.debug(`Created build script: ${scriptPath}`);

		// Create terminal and run the script (shellPath and shellArgs hide the command from display)
		const terminal = vscode.window.createTerminal({
			name: 'Dev Container Build',
			iconPath: new vscode.ThemeIcon('debug-console'),
			shellPath: '/bin/sh',
			shellArgs: [scriptPath]
		});
		terminal.show();

		// Wait for the marker file to appear
		logger.debug('Waiting for container build to complete...');
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

		// Read the container ID and name
		let containerId: string;
		let containerName: string;
		try {
			containerId = fs.readFileSync(containerIdPath, 'utf8').trim();
			containerName = fs.readFileSync(containerNamePath, 'utf8').trim();
			logger.info(`Container created: ${containerId} (${containerName})`);
		} catch (error) {
			throw new Error(`Failed to read container info: ${error}`);
		} finally {
			// Clean up temporary files
			try {
				fs.unlinkSync(scriptPath);
				fs.unlinkSync(markerPath);
				fs.unlinkSync(containerIdPath);
				fs.unlinkSync(containerNamePath);
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
