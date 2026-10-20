/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { constants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { mcpConnectionsDirectory } from './mcpConnection';

/**
 * The launcher's name. The supervisor binary runs only the stdio bridge when
 * started under this name, and finds the connections directory from where it
 * is kept.
 */
const LAUNCHER_NAME = 'positron-mcp';

/**
 * Where the launcher is kept: a copy of the supervisor binary in the
 * connections directory, which does not move when Positron is updated, so an
 * agent configured to start it never has to be reconfigured.
 *
 * @param storageUri The extension's global storage directory.
 * @returns The path to the launcher.
 */
export function mcpLauncherPath(storageUri: vscode.Uri): string {
	const name = os.platform() === 'win32' ? `${LAUNCHER_NAME}.exe` : LAUNCHER_NAME;
	return path.join(mcpConnectionsDirectory(storageUri), 'bin', name);
}

/**
 * Whether the launcher has been put in place.
 *
 * @param storageUri The extension's global storage directory.
 */
export async function mcpLauncherInstalled(storageUri: vscode.Uri): Promise<boolean> {
	return !!(await fs.stat(mcpLauncherPath(storageUri)).catch(() => undefined));
}

/**
 * Copy the supervisor binary to the launcher, unless the launcher is already a
 * copy of it.
 *
 * The copy is a clone where the filesystem supports one, and takes the
 * binary's modification time, which is how a later call tells it is current.
 *
 * @param storageUri The extension's global storage directory.
 * @param supervisorPath The supervisor binary.
 * @param log Writes a line to the Kernel Supervisor output channel.
 */
export async function installMcpLauncher(
	storageUri: vscode.Uri,
	supervisorPath: string,
	log: (message: string) => void,
): Promise<void> {
	const target = mcpLauncherPath(storageUri);
	const source = await fs.stat(supervisorPath);
	const current = await fs.stat(target).catch(() => undefined);
	if (current && current.size === source.size &&
		Math.trunc(current.mtimeMs) === Math.trunc(source.mtimeMs)) {
		return;
	}

	log(`Copying ${supervisorPath} to ${target}, which coding agents start as Positron's MCP server`);
	const directory = path.dirname(target);
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	await removeReplacedLaunchers(directory);

	// Copied beside the launcher and renamed over it, so an agent starting it
	// never finds half a binary.
	const temporary = `${target}.${process.pid}.tmp`;
	try {
		await fs.copyFile(supervisorPath, temporary, constants.COPYFILE_FICLONE);
		await fs.utimes(temporary, source.atime, source.mtime);
		await replaceFile(temporary, target);
	} finally {
		await fs.rm(temporary, { force: true });
	}
}

/**
 * Rename a file over another.
 *
 * Windows will not replace an executable that is running, as the launcher is
 * while any agent is connected, but will rename it out of the way.
 */
async function replaceFile(source: string, target: string): Promise<void> {
	try {
		await fs.rename(source, target);
	} catch (err) {
		if (os.platform() !== 'win32') {
			throw err;
		}
		await fs.rename(target, `${target}.${process.pid}.${Date.now()}.old`);
		await fs.rename(source, target);
	}
}

/**
 * Remove the launchers {@link replaceFile} moved aside. Any still running
 * cannot be removed, and are left for next time.
 */
async function removeReplacedLaunchers(directory: string): Promise<void> {
	for (const name of await fs.readdir(directory)) {
		if (name.endsWith('.old')) {
			await fs.rm(path.join(directory, name), { force: true }).catch(() => { });
		}
	}
}
