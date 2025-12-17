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
import { prepareFeaturesInstallation, generateFeatureInstallScript, cleanupFeaturesDir } from './featuresInstaller';
import { Mount } from '../spec/spec-configuration/containerFeaturesConfiguration';

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
 * Generates lifecycle hooks script to be included in the build script
 */
function generateLifecycleHooksScript(
	devContainerConfig: any,
	dockerPath: string,
	remoteCwd: string,
	isWindows: boolean
): string {
	let script = '';

	// Build map of hooks to run
	const hooksToRun: Record<string, any> = {};
	const hooks = [
		'onCreateCommand',
		'updateContentCommand',
		'postCreateCommand',
		'postStartCommand',
		'postAttachCommand',
	];

	for (const hook of hooks) {
		if (devContainerConfig[hook]) {
			hooksToRun[hook] = devContainerConfig[hook];
		}
	}

	// Generate commands for each hook
	for (const [hookName, command] of Object.entries(hooksToRun)) {
		// Convert command to shell script
		let shellCommand: string;

		if (typeof command === 'string') {
			shellCommand = command;
		} else if (Array.isArray(command)) {
			// Array of commands - run them sequentially
			shellCommand = command.join(' && ');
		} else if (typeof command === 'object') {
			// Object with named commands - run them sequentially
			const commands = Object.entries(command).map(([name, cmd]) => {
				const cmdStr = Array.isArray(cmd) ? (cmd as string[]).join(' ') : cmd;
				return `echo "Running ${name}..." && ${cmdStr}`;
			});
			shellCommand = commands.join(' && ');
		} else {
			continue;
		}

		// Escape the command for the shell
		const escapedCommand = isWindows
			? shellCommand.replace(/"/g, '`"')
			: shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');

		// Add to script
		if (isWindows) {
			script += `Write-Host "==> Running ${hookName}..."\n`;
			script += `& ${escapePowerShellArg(dockerPath)} exec -w "${remoteCwd}" $CONTAINER_ID sh -c "${escapedCommand}"\n`;
			script += 'if ($LASTEXITCODE -ne 0) {\n';
			script += `    Write-Host "WARNING: ${hookName} failed with exit code $LASTEXITCODE" -ForegroundColor Yellow\n`;
			script += '}\n\n';
		} else {
			script += `echo "==> Running ${hookName}..."\n`;
			script += `${dockerPath} exec -w "${remoteCwd}" $CONTAINER_ID sh -c "${escapedCommand}"\n\n`;
		}
	}

	return script;
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

		// Find the devcontainer.json file - check both standard locations
		let devcontainerPath = path.join(workspaceFolder, '.devcontainer', 'devcontainer.json');
		if (!fs.existsSync(devcontainerPath)) {
			// Try .devcontainer.json in workspace root
			devcontainerPath = path.join(workspaceFolder, '.devcontainer.json');
			if (!fs.existsSync(devcontainerPath)) {
				throw new Error(`Dev container configuration not found. Expected at ${path.join(workspaceFolder, '.devcontainer', 'devcontainer.json')} or ${path.join(workspaceFolder, '.devcontainer.json')}`);
			}
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
		const errorPath = path.join(os.tmpdir(), `devcontainer-build-${timestamp}.error`);
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
			script += '# Write error marker and exit 0 to avoid VS Code toast about exit code\n';
			script += `trap 'echo ""; echo "==> ERROR: Build failed! Press Enter to close this terminal..."; echo "failed" > "${errorPath}"; read dummy; exit 0' ERR\n\n`;

			if (rebuild) {
				script += 'echo "==> Removing existing containers..."\n';
				script += `${dockerPath} ps -a -q --filter "label=devcontainer.local_folder=${escapeShellArg(workspaceFolder)}" | xargs ${dockerPath} rm -f 2>/dev/null || true\n\n`;
			}

			return script;
		};

		const generatePowerShellScript = () => {
			let script = '$ErrorActionPreference = "Stop"\n\n';
			script += '# Trap errors to keep terminal open so user can see what failed\n';
			script += '# Write error marker and exit 0 to avoid VS Code toast about exit code\n';
			script += 'trap {\n';
			script += '    Write-Host ""\n';
			script += '    Write-Host "==> ERROR: Build failed!"\n';
			script += '    Write-Host "Error: $_" -ForegroundColor Red\n';
			script += '    Write-Host ""\n';
			script += `    "failed" | Out-File -FilePath "${errorPath}" -Encoding utf8\n`;
			script += '    Write-Host "Press Enter to close this terminal..."\n';
			script += '    Read-Host\n';
			script += '    exit 0\n';
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

		// Prepare mounts array - handle both string and Mount object formats
		const mounts: string[] = [];
		if (devContainerConfig.mounts) {
			for (const mount of devContainerConfig.mounts) {
				if (typeof mount === 'string') {
					mounts.push(mount);
				} else {
					// Convert Mount object to string format for --mount option
					const mountObj = mount as Mount;
					const type = `type=${mountObj.type}`;
					const source = mountObj.source ? `,src=${mountObj.source}` : '';
					const target = `,dst=${mountObj.target}`;
					mounts.push(`${type}${source}${target}`);
				}
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

		// Prepare features installation (must happen before generating the script)
		logger.info('==> Preparing features installation...');
		logger.debug(`DevContainer config keys: ${Object.keys(devContainerConfig).join(', ')}`);
		logger.debug(`Features in config: ${JSON.stringify(devContainerConfig.features)}`);
		const featuresInfo = await prepareFeaturesInstallation(workspaceFolder, devContainerConfig);

		logger.info(`Features info result: hasFeatures=${featuresInfo.hasFeatures}`);
		if (featuresInfo.featuresConfig) {
			logger.info(`Features config: ${featuresInfo.featuresConfig.featureSets.length} feature sets`);
		}
		if (featuresInfo.featuresDir) {
			logger.info(`Features dir: ${featuresInfo.featuresDir}`);
		}

		// Install features if any are configured
		if (featuresInfo.hasFeatures && featuresInfo.featuresConfig && featuresInfo.featuresDir) {
			logger.info('==> Adding features installation to build script');
			const featureScript = generateFeatureInstallScript(
				featuresInfo.featuresConfig,
				featuresInfo.featuresDir,
				dockerPath,
				isWindows
			);
			logger.info(`Generated feature script length: ${featureScript.length} characters`);
			logger.debug(`Feature script preview:\n${featureScript.substring(0, 500)}`);
			scriptContent += featureScript;
		} else {
			logger.warn(`Skipping features installation: hasFeatures=${featuresInfo.hasFeatures}, hasConfig=${!!featuresInfo.featuresConfig}, hasDir=${!!featuresInfo.featuresDir}`);
		}

		// Add lifecycle hooks to the build script
		// This runs them as part of the script so there's no separate terminal output
		const lifecycleScript = generateLifecycleHooksScript(
			devContainerConfig,
			dockerPath,
			remoteWorkspaceFolder,
			isWindows
		);
		scriptContent += lifecycleScript;

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

		// Also save to a debug location for inspection
		const debugScriptPath = path.join(os.tmpdir(), `devcontainer-last-build${scriptExt}`);
		try {
			fs.writeFileSync(debugScriptPath, scriptContent, { mode: 0o755 });
			logger.info(`Debug copy saved to: ${debugScriptPath}`);
		} catch (error) {
			logger.debug(`Could not save debug copy: ${error}`);
		}

		logger.info(`Created build script: ${scriptPath}`);
		logger.debug(`Script content (first 1000 chars):\n${scriptContent.substring(0, 1000)}`);

		// Create terminal that executes the script directly without showing the command
		const terminalOptions: vscode.TerminalOptions = {
			name: 'Dev Container Build',
			iconPath: new vscode.ThemeIcon('debug-console'),
			shellPath: isWindows ? 'powershell.exe' : '/bin/sh',
			shellArgs: isWindows ? ['-NoProfile', '-File', scriptPath] : [scriptPath],
		};

		const terminal = vscode.window.createTerminal(terminalOptions);
		terminal.show();

		// Wait for the marker file to appear
		logger.debug('Waiting for container build to complete...');
		const startTime = Date.now();
		const timeout = 10 * 60 * 1000; // 10 minutes

		while (true) {
			// Check for success marker
			if (fs.existsSync(markerPath)) {
				break;
			}

			// Check for error marker (build failed but exited cleanly)
			if (fs.existsSync(errorPath)) {
				// Clean up
				try {
					fs.unlinkSync(scriptPath);
					fs.unlinkSync(errorPath);
				} catch { }
				throw new Error('Container build failed. Check the terminal output for details.');
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
				fs.unlinkSync(errorPath);
				fs.unlinkSync(containerIdPath);
				fs.unlinkSync(containerNamePath);
			} catch { }

			// Clean up features directory if it was created
			if (featuresInfo.hasFeatures && featuresInfo.featuresDir) {
				logger.debug('Cleaning up features directory');
				await cleanupFeaturesDir(featuresInfo.featuresDir);
			}
		}

		return {
			terminal,
			containerId,
			containerName,
			remoteWorkspaceFolder
		};
	}
}
