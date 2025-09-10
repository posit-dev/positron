/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { arch, platform } from 'os';
import * as path from 'path';

async function getNpmCopilotVersion(copilotDir: string): Promise<string> {
	const packageJsonPath = path.join(copilotDir, 'package.json');
	const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
	if (packageJson.version === undefined) {
		throw new Error('Version not found in package.json');
	}
	return packageJson.version;
}

async function getBundledCopilotVersion(versionPath: string): Promise<string | undefined> {
	try {
		return await readFile(versionPath, 'utf8');
	} catch (error) {
		// Ignore ENOENT errors e.g. if this is the first run.
		if (error instanceof Error &&
			'code' in error &&
			error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

async function main() {
	const bundleDir = path.join('resources', 'copilot');
	await mkdir(bundleDir, { recursive: true });

	const npmDir = path.join('node_modules', '@github', 'copilot-language-server');
	const npmVersion = await getNpmCopilotVersion(npmDir);

	const bundleVersionPath = path.join(bundleDir, 'VERSION');
	const bundleVersion = await getBundledCopilotVersion(bundleVersionPath);

	if (bundleVersion === npmVersion) {
		console.log(`Copilot Language Server ${npmVersion} is already installed.`);
		return;
	}

	console.log(`Updating Copilot Language Server: ${bundleVersion} -> ${npmVersion}`);
	const serverName = platform() === 'win32' ? 'copilot-language-server.exe' : 'copilot-language-server';

	// There is no win32-arm64 build yet; try to use x64 instead.
	// See: https://github.com/github/copilot-language-server-release/issues/5.
	// Bundle both arm64 and x64 for macOS, and use the one that matches the
	// current architecture on Linux.
	const targetArches = platform() === 'win32' ? ['x64'] :
		[process.env.npm_config_arch || arch()];

	// Copy the server for each target architecture.
	for (const targetArch of targetArches) {
		// Use the architecture as a subdirectory for macOS.
		const serverDir = platform() === 'darwin' ?
			path.join(bundleDir, targetArch) : bundleDir;

		await mkdir(serverDir, { recursive: true });
		const npmServerPath = path.join(`${npmDir}-${platform()}-${targetArch}`, serverName);
		const bundledServerPath = path.join(serverDir, serverName);
		await copyFile(npmServerPath, bundledServerPath);
	}

	// Write the new version to the VERSION file.
	await writeFile(bundleVersionPath, npmVersion, 'utf8');
}

main().catch(error => {
	console.error('An error occurred:', error);
});

