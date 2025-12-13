/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as semver from 'semver';
import { spawnSync } from 'child_process';

import { LOGGER } from './extension';
import {
	JuliaInstallation,
	ReasonDiscovered,
	MIN_JULIA_VERSION,
	isValidJuliaInstallation
} from './julia-installation';

/**
 * Discovers all Julia installations on the system.
 */
export async function* juliaRuntimeDiscoverer(): AsyncGenerator<JuliaInstallation> {
	const discovered = new Set<string>();

	// Helper to yield unique installations
	const yieldIfNew = function* (installation: JuliaInstallation | undefined) {
		if (installation && !discovered.has(installation.binpath)) {
			discovered.add(installation.binpath);
			if (isValidJuliaInstallation(installation)) {
				yield installation;
			} else {
				LOGGER.info(`Skipping Julia ${installation.version} (below minimum ${MIN_JULIA_VERSION})`);
			}
		}
	};

	// 1. Check PATH
	LOGGER.debug('Searching for Julia in PATH...');
	yield* yieldIfNew(await discoverFromPath());

	// 2. Check juliaup
	LOGGER.debug('Searching for Julia via juliaup...');
	for await (const installation of discoverFromJuliaup()) {
		yield* yieldIfNew(installation);
	}

	// 3. Check standard installation locations
	LOGGER.debug('Searching for Julia in standard locations...');
	for await (const installation of discoverFromStandardLocations()) {
		yield* yieldIfNew(installation);
	}
}

/**
 * Discovers Julia from PATH.
 */
async function discoverFromPath(): Promise<JuliaInstallation | undefined> {
	try {
		const result = spawnSync('which', ['julia'], { encoding: 'utf-8' });
		if (result.status === 0 && result.stdout) {
			const binpath = result.stdout.trim();
			return await createJuliaInstallation(binpath, ReasonDiscovered.PATH, true);
		}
	} catch (error) {
		LOGGER.debug(`Failed to find Julia in PATH: ${error}`);
	}
	return undefined;
}

/**
 * Discovers Julia installations managed by juliaup.
 */
async function* discoverFromJuliaup(): AsyncGenerator<JuliaInstallation> {
	// Try command-line juliaup first
	let foundViaCommand = false;
	try {
		// Check if juliaup is available
		const juliaupResult = spawnSync('which', ['juliaup'], { encoding: 'utf-8' });
		if (juliaupResult.status === 0) {
			foundViaCommand = true;

			// Get juliaup status
			const statusResult = spawnSync('juliaup', ['status'], { encoding: 'utf-8' });
			if (statusResult.status === 0) {
				// Parse juliaup status output
				// Format: " Default  Channel  Version  Update"
				//         "       *  1.10     1.10.10+0.aarch64.apple.darwin14"
				const lines = statusResult.stdout.split('\n');
				for (const line of lines) {
					const match = line.match(/^\s*(\*)?\s+(\S+)\s+(\S+)/);
					if (match) {
						const isDefault = match[1] === '*';
						const channel = match[2];

						// Skip header line
						if (channel === 'Channel' || channel === '---') {
							continue;
						}

						// Get the actual binary path for this channel
						try {
							const pathResult = spawnSync('juliaup', ['which', channel], { encoding: 'utf-8' });
							if (pathResult.status === 0 && pathResult.stdout) {
								const binpath = pathResult.stdout.trim();
								const installation = await createJuliaInstallation(
									binpath,
									ReasonDiscovered.JULIAUP,
									isDefault
								);
								if (installation) {
									yield installation;
								}
							}
						} catch (error) {
							LOGGER.debug(`Failed to get path for Julia channel ${channel}: ${error}`);
						}
					}
				}
			}
		}
	} catch (error) {
		LOGGER.debug(`Failed to discover Julia via juliaup command: ${error}`);
	}

	// If juliaup command wasn't available, try reading juliaup.json directly
	if (!foundViaCommand) {
		yield* discoverFromJuliaupDirectory();
	}
}

/**
 * Discovers Julia installations by reading the juliaup.json file directly.
 * This is used when the juliaup command isn't available in PATH.
 */
async function* discoverFromJuliaupDirectory(): AsyncGenerator<JuliaInstallation> {
	const juliaupDir = path.join(os.homedir(), '.julia', 'juliaup');
	const juliaupConfigPath = path.join(juliaupDir, 'juliaup.json');

	if (!fs.existsSync(juliaupConfigPath)) {
		return;
	}

	try {
		const configContent = fs.readFileSync(juliaupConfigPath, 'utf-8');
		const config = JSON.parse(configContent) as {
			Default?: string;
			InstalledVersions?: Record<string, { Path: string }>;
			InstalledChannels?: Record<string, { Version: string }>;
		};

		const defaultChannel = config.Default;
		const installedVersions = config.InstalledVersions || {};
		const installedChannels = config.InstalledChannels || {};

		// Find the default version
		let defaultVersion: string | undefined;
		if (defaultChannel && installedChannels[defaultChannel]) {
			defaultVersion = installedChannels[defaultChannel].Version;
		}

		// Iterate through installed versions
		for (const [versionKey, versionInfo] of Object.entries(installedVersions)) {
			let versionPath = versionInfo.Path;

			// Handle relative paths
			if (versionPath.startsWith('./')) {
				versionPath = path.join(juliaupDir, versionPath.slice(2));
			} else if (!path.isAbsolute(versionPath)) {
				versionPath = path.join(juliaupDir, versionPath);
			}

			const binpath = path.join(versionPath, 'bin', 'julia');
			if (fs.existsSync(binpath)) {
				const isDefault = versionKey === defaultVersion;
				const installation = await createJuliaInstallation(
					binpath,
					ReasonDiscovered.JULIAUP,
					isDefault
				);
				if (installation) {
					yield installation;
				}
			}
		}
	} catch (error) {
		LOGGER.debug(`Failed to read juliaup.json: ${error}`);
	}
}

/**
 * Discovers Julia from standard installation locations.
 */
async function* discoverFromStandardLocations(): AsyncGenerator<JuliaInstallation> {
	const platform = os.platform();
	const locations: string[] = [];

	if (platform === 'darwin') {
		// macOS standard locations
		locations.push('/Applications');
		locations.push(path.join(os.homedir(), 'Applications'));

		// Check for Julia.app bundles
		for (const appDir of locations) {
			if (fs.existsSync(appDir)) {
				try {
					const entries = fs.readdirSync(appDir);
					for (const entry of entries) {
						if (entry.startsWith('Julia-') && entry.endsWith('.app')) {
							const binpath = path.join(
								appDir, entry, 'Contents', 'Resources', 'julia', 'bin', 'julia'
							);
							if (fs.existsSync(binpath)) {
								const installation = await createJuliaInstallation(
									binpath,
									ReasonDiscovered.STANDARD,
									false
								);
								if (installation) {
									yield installation;
								}
							}
						}
					}
				} catch (error) {
					LOGGER.debug(`Failed to search ${appDir}: ${error}`);
				}
			}
		}
	} else if (platform === 'linux') {
		// Linux standard locations
		const linuxPaths = [
			'/usr/bin/julia',
			'/usr/local/bin/julia',
			'/opt/julia/bin/julia',
		];

		// Also check /opt for versioned installations
		if (fs.existsSync('/opt')) {
			try {
				const entries = fs.readdirSync('/opt');
				for (const entry of entries) {
					if (entry.startsWith('julia-')) {
						linuxPaths.push(path.join('/opt', entry, 'bin', 'julia'));
					}
				}
			} catch (error) {
				LOGGER.debug(`Failed to search /opt: ${error}`);
			}
		}

		for (const binpath of linuxPaths) {
			if (fs.existsSync(binpath)) {
				const installation = await createJuliaInstallation(
					binpath,
					ReasonDiscovered.STANDARD,
					false
				);
				if (installation) {
					yield installation;
				}
			}
		}
	} else if (platform === 'win32') {
		// Windows standard locations
		const localAppData = process.env.LOCALAPPDATA || '';
		const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

		const windowsPaths: string[] = [];

		// Check LocalAppData for user installations
		if (localAppData) {
			const juliaDir = path.join(localAppData, 'Programs');
			if (fs.existsSync(juliaDir)) {
				try {
					const entries = fs.readdirSync(juliaDir);
					for (const entry of entries) {
						if (entry.startsWith('Julia-') || entry.startsWith('Julia ')) {
							windowsPaths.push(path.join(juliaDir, entry, 'bin', 'julia.exe'));
						}
					}
				} catch (error) {
					LOGGER.debug(`Failed to search ${juliaDir}: ${error}`);
				}
			}
		}

		// Check Program Files
		if (fs.existsSync(programFiles)) {
			try {
				const entries = fs.readdirSync(programFiles);
				for (const entry of entries) {
					if (entry.startsWith('Julia-') || entry.startsWith('Julia ')) {
						windowsPaths.push(path.join(programFiles, entry, 'bin', 'julia.exe'));
					}
				}
			} catch (error) {
				LOGGER.debug(`Failed to search ${programFiles}: ${error}`);
			}
		}

		for (const binpath of windowsPaths) {
			if (fs.existsSync(binpath)) {
				const installation = await createJuliaInstallation(
					binpath,
					ReasonDiscovered.STANDARD,
					false
				);
				if (installation) {
					yield installation;
				}
			}
		}
	}
}

/**
 * Creates a JuliaInstallation from a binary path by querying Julia for its info.
 */
async function createJuliaInstallation(
	binpath: string,
	reasonDiscovered: ReasonDiscovered,
	current: boolean
): Promise<JuliaInstallation | undefined> {
	try {
		// Get version and system info from Julia
		const versionScript = `
			println(VERSION)
			println(Sys.BINDIR)
			println(Sys.ARCH)
		`;

		const result = spawnSync(binpath, ['-e', versionScript], {
			encoding: 'utf-8',
			timeout: 10000,
		});

		if (result.status !== 0) {
			LOGGER.debug(`Failed to get Julia info from ${binpath}: ${result.stderr}`);
			return undefined;
		}

		const lines = result.stdout.trim().split('\n');
		if (lines.length < 3) {
			LOGGER.debug(`Unexpected output from Julia at ${binpath}`);
			return undefined;
		}

		const version = lines[0].trim();
		const homepath = lines[1].trim();
		const arch = lines[2].trim();

		const semVersion = semver.parse(version);
		if (!semVersion) {
			LOGGER.debug(`Failed to parse Julia version: ${version}`);
			return undefined;
		}

		return {
			binpath,
			homepath,
			version,
			semVersion,
			arch,
			reasonDiscovered,
			current,
		};
	} catch (error) {
		LOGGER.debug(`Failed to create installation from ${binpath}: ${error}`);
		return undefined;
	}
}
