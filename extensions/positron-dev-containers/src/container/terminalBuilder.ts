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
 * Escapes a PowerShell argument properly
 */
function escapePowerShellArg(arg: string): string {
	// If the argument contains spaces or special characters, wrap in single quotes
	// Single quotes in PowerShell are literal strings (no variable expansion)
	if (/[\s"'`$(){}[\]&|<>^]/.test(arg)) {
		// Escape single quotes by doubling them, then wrap in single quotes
		return `'${arg.replace(/'/g, "''")}'`;
	}
	return arg;
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

		// Determine platform-specific settings
		const isWindows = os.platform() === 'win32';
		const timestamp = Date.now();
		const scriptExt = isWindows ? '.ps1' : '.sh';
		const scriptPath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}${scriptExt}`);
		const markerPath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.done`);
		const containerIdPath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.id`);
		const containerNamePath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.name`);

		// Helper function to generate script content
		const generateScriptContent = () => {
			if (isWindows) {
				return generatePowerShellScript();
			} else {
				return generateShellScript();
			}
		};

		const generateShellScript = () => {
			let script = '#!/bin/sh\nset -e\n\n';
			script += '# Trap errors to keep terminal open so user can see what failed\n';
			script += 'trap \'echo ""; echo "==> ERROR: Build failed! Press Enter to close this terminal..."; read dummy\' ERR\n\n';

			if (rebuild) {
				script += 'echo "==> Removing existing containers..."\n';
				script += `${dockerPath} ps -a -q --filter "label=devcontainer.local_folder=${escapeShellArg(workspaceFolder)}" | xargs ${dockerPath} rm -f 2>/dev/null || true\n\n`;
			}

			return script;
		};

		const generatePowerShellScript = () => {
			let script = '$ErrorActionPreference = "Stop"\n\n';
			script += '# Trap errors to keep terminal open so user can see what failed\n';
			script += 'trap {\n';
			script += '    Write-Host ""\n';
			script += '    Write-Host "==> ERROR: Build failed!"\n';
			script += '    Write-Host "Error: $_" -ForegroundColor Red\n';
			script += '    Write-Host ""\n';
			script += '    Write-Host "Press Enter to close this terminal..."\n';
			script += '    Read-Host\n';
			script += '    exit 1\n';
			script += '}\n\n';

			if (rebuild) {
				script += 'Write-Host "==> Removing existing containers..."\n';
				const filterArg = `label=devcontainer.local_folder=${workspaceFolder.replace(/\\/g, '\\\\')}`;
				script += `$containers = & ${escapePowerShellArg(dockerPath)} ps -a -q --filter "${filterArg}"\n`;
				script += 'if ($containers) {\n';
				script += `    & ${escapePowerShellArg(dockerPath)} rm -f $containers 2>$null\n`;
				script += '}\n\n';
			}

			return script;
		};

		let scriptContent = generateScriptContent();

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

			logger.debug(`Docker command: ${buildCmd.command}`);
			logger.debug(`Docker args: ${JSON.stringify(buildCmd.args)}`);

			// Format command for the appropriate platform
			if (isWindows) {
				scriptContent += 'Write-Host "==> ' + buildCmd.description + '"\n';
				logger.debug(`Docker command: ${buildCmd.command}`);
				logger.debug(`Docker args: ${JSON.stringify(buildCmd.args)}`);
				scriptContent += `Write-Host "Running: ${buildCmd.command.replace(/\\/g, '\\\\')} ${buildCmd.args.join(' ')}" -ForegroundColor Cyan\n`;
				// Build the full command line and execute via cmd.exe to avoid window spawning
				// Escape quotes in the command line for cmd.exe
				const cmdLine = `"${buildCmd.command}" ${buildCmd.args.map(arg => {
					// For cmd.exe, we need to escape quotes and wrap args with spaces in quotes
					if (arg.includes(' ') || arg.includes('"')) {
						return `"${arg.replace(/"/g, '""')}"`;
					}
					return arg;
				}).join(' ')}`;
				scriptContent += `cmd /c "${cmdLine.replace(/"/g, '""')}"\n`;
				scriptContent += 'if ($LASTEXITCODE -ne 0) {\n';
				scriptContent += '    throw "Docker build failed with exit code $LASTEXITCODE"\n';
				scriptContent += '}\n\n';
			} else {
				scriptContent += formatCommandWithEcho(buildCmd) + '\n\n';
			}
		} else {
			const echoCmd = isWindows ? 'Write-Host' : 'echo';
			scriptContent += `${echoCmd} "==> Using image: ${imageName}"\n\n`;
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

		if (isWindows) {
			scriptContent += 'Write-Host "==> Creating container..."\n';
			// Build command line and execute via cmd.exe to capture output and avoid window spawning
			const createCmdLine = `"${dockerPath}" ${createCmd.args.map(arg => {
				if (arg.includes(' ') || arg.includes('"')) {
					return `"${arg.replace(/"/g, '""')}"`;
				}
				return arg;
			}).join(' ')}`;
			scriptContent += `$CONTAINER_ID = cmd /c "${createCmdLine.replace(/"/g, '""')}"\n`;
			scriptContent += 'if ($LASTEXITCODE -ne 0) {\n';
			scriptContent += '    throw "Failed to create container with exit code $LASTEXITCODE"\n';
			scriptContent += '}\n';
			scriptContent += '$CONTAINER_ID = $CONTAINER_ID.Trim()\n';
			scriptContent += 'if (-not $CONTAINER_ID) {\n';
			scriptContent += '    throw "Failed to create container - no container ID returned"\n';
			scriptContent += '}\n';
			scriptContent += 'Write-Host "Container ID: $CONTAINER_ID"\n\n';

			scriptContent += 'Write-Host "==> Starting container..."\n';
			// Use PowerShell's call operator (&) to execute docker directly
			scriptContent += `& ${escapePowerShellArg(dockerPath)} start $CONTAINER_ID\n`;
			scriptContent += 'if ($LASTEXITCODE -ne 0) {\n';
			scriptContent += '    throw "Failed to start container with exit code $LASTEXITCODE"\n';
			scriptContent += '}\n\n';
		} else {
			scriptContent += 'echo "==> Creating container..."\n';
			scriptContent += `CONTAINER_ID=$(${dockerPath} ${createCmd.args.join(' ')})\n`;
			scriptContent += 'echo "Container ID: $CONTAINER_ID"\n\n';

			scriptContent += 'echo "==> Starting container..."\n';
			scriptContent += `${dockerPath} start $CONTAINER_ID\n\n`;
		}

		// Run post-create command if specified
		if (devContainerConfig.postCreateCommand) {
			let postCreateCmd: string;
			if (typeof devContainerConfig.postCreateCommand === 'string') {
				postCreateCmd = devContainerConfig.postCreateCommand;
			} else if (Array.isArray(devContainerConfig.postCreateCommand)) {
				postCreateCmd = devContainerConfig.postCreateCommand.join(' ');
			} else {
				postCreateCmd = '';
			}
			if (postCreateCmd) {
				if (isWindows) {
					scriptContent += 'Write-Host "==> Running post-create command..."\n';
					const escapedCmd = postCreateCmd.replace(/"/g, '`"');
					const execCmdLine = `"${dockerPath}" exec $CONTAINER_ID sh -c "${escapedCmd}"`;
					scriptContent += `cmd /c "${execCmdLine.replace(/"/g, '""')}"\n`;
					scriptContent += 'if ($LASTEXITCODE -ne 0) {\n';
					scriptContent += '    Write-Host "Note: Post-create command had non-fatal errors (this is common with bind-mounted .git directories)"\n';
					scriptContent += '}\n\n';
				} else {
					scriptContent += 'echo "==> Running post-create command..."\n';
					const escapedCmd = postCreateCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
					scriptContent += `${dockerPath} exec $CONTAINER_ID sh -c "${escapedCmd}" || echo "Note: Post-create command had non-fatal errors (this is common with bind-mounted .git directories)"\n\n`;
				}
			}
		}

		// Save container ID and name
		if (isWindows) {
			scriptContent += 'Write-Host "==> Saving container info..."\n';
			scriptContent += `$CONTAINER_ID | Out-File -FilePath "${containerIdPath}" -Encoding utf8 -NoNewline\n`;
			const inspectCmdLine = `"${dockerPath}" inspect -f '{{.Name}}' $CONTAINER_ID`;
			scriptContent += `$containerName = cmd /c "${inspectCmdLine.replace(/"/g, '""')}"\n`;
			scriptContent += '$containerName = $containerName.Trim()\n';
			scriptContent += 'if (-not $containerName) {\n';
			scriptContent += '    throw "Failed to get container name"\n';
			scriptContent += '}\n';
			scriptContent += `$containerName.TrimStart('/') | Out-File -FilePath "${containerNamePath}" -Encoding utf8 -NoNewline\n\n`;

			scriptContent += 'Write-Host "==> Container ready!"\n';
			scriptContent += `"done" | Out-File -FilePath "${markerPath}" -Encoding utf8\n`;
			scriptContent += '$ErrorActionPreference = "Continue"\n';
			scriptContent += 'exit 0\n';
		} else {
			scriptContent += 'echo "==> Saving container info..."\n';
			scriptContent += `echo "$CONTAINER_ID" > "${containerIdPath}"\n`;
			scriptContent += `${dockerPath} inspect -f '{{.Name}}' $CONTAINER_ID | sed 's/^\\///' > "${containerNamePath}"\n\n`;

			scriptContent += 'echo "==> Container ready!"\n';
			scriptContent += `echo "done" > "${markerPath}"\n`;
			scriptContent += 'trap - ERR\n';
			scriptContent += 'exit 0\n';
		}

		// Write the script file
		fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

		logger.debug(`Created build script: ${scriptPath}`);

		// Create terminal and run the script
		const terminalOptions: vscode.TerminalOptions = {
			name: 'Dev Container Build',
			iconPath: new vscode.ThemeIcon('debug-console'),
		};

		const terminal = vscode.window.createTerminal(terminalOptions);
		terminal.show();

		// Send command to execute the script in the terminal
		if (isWindows) {
			// Use & to execute the script file in the current terminal session
			terminal.sendText(`& '${scriptPath}'`);
		} else {
			terminal.sendText(`sh '${scriptPath}'`);
		}

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
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to read container info: ${errorMessage}`);
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
