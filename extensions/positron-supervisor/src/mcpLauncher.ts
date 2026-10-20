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
 * The launcher's name. On Windows the launcher is a copy of the supervisor
 * binary, which runs only the stdio bridge when started under this name, and
 * finds the connections directory from where it is kept.
 */
const LAUNCHER_NAME = 'positron-mcp';

/**
 * Where the launcher is kept: the connections directory, which does not move
 * when Positron is updated, so an agent configured to start it never has to be
 * reconfigured.
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
 * Put the launcher in place, or point it at the given supervisor binary.
 *
 * On macOS and Linux the launcher is a shell script that runs the supervisor's
 * stdio bridge. Agents on Windows cannot start a script without a shell, so
 * there the launcher is a copy of the supervisor binary, which keeps its
 * signature and the trust that comes with it.
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
	if (os.platform() === 'win32') {
		await copyLauncher(target, supervisorPath, log);
	} else {
		await writeLauncherScript(target, supervisorPath, mcpConnectionsDirectory(storageUri), log);
	}
}

/**
 * Write the launcher script, unless it already runs this supervisor.
 */
async function writeLauncherScript(
	target: string,
	supervisorPath: string,
	connectionsDirectory: string,
	log: (message: string) => void,
): Promise<void> {
	const script = '#!/bin/sh\n' +
		`exec ${shellQuote(supervisorPath)} mcp-stdio --connections ${shellQuote(connectionsDirectory)} "$@"\n`;
	if (await fs.readFile(target, 'utf8').catch(() => undefined) === script) {
		return;
	}

	log(`Writing ${target}, which coding agents start as Positron's MCP server, to run ${supervisorPath}`);
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	await writeAndReplace(target, temporary => fs.writeFile(temporary, script, { mode: 0o755 }));
}

/** Quote a string for a POSIX shell. */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Copy the supervisor binary to the launcher, unless the launcher is already a
 * copy of it.
 *
 * The copy takes the binary's modification time, which is how a later call
 * tells it is current.
 */
async function copyLauncher(
	target: string,
	supervisorPath: string,
	log: (message: string) => void,
): Promise<void> {
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
	await writeAndReplace(target, async temporary => {
		await fs.copyFile(supervisorPath, temporary, constants.COPYFILE_FICLONE);
		await fs.utimes(temporary, source.atime, source.mtime);
	});
}

/**
 * Write a file beside the launcher and rename it over the launcher, so an
 * agent starting it never finds half a file.
 */
async function writeAndReplace(target: string, write: (temporary: string) => Promise<void>): Promise<void> {
	const temporary = `${target}.${process.pid}.tmp`;
	try {
		await write(temporary);
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
