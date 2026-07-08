/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { FileAccess } from '../../../base/common/network.js';
import { join } from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { ClaudeCliRegistrationState } from '../common/positronMcp.js';

const execFileAsync = promisify(execFile);

/**
 * Registers the bundled stdio proxy (positronMcpProxy.ts) with the Claude
 * Code CLI at user scope, so `claude` launched from any Positron integrated
 * terminal reaches this machine's Positron MCP server with no `.mcp.json` in
 * the workspace (and no repo-committed config at all).
 *
 * The proxy is copied out of the application to a stable path in the user
 * data directory first: the registered command must survive Positron
 * updates relocating the app bundle's contents. It is launched through
 * Positron's own binary under ELECTRON_RUN_AS_NODE, so it works on machines
 * with no `node` on PATH. Registration is diff-gated on a marker file plus a
 * `claude mcp get` probe, so the CLI's config is only rewritten when
 * something actually changed (or the user removed the entry manually).
 */

/** The name the proxy is registered under and the marker/proxy file names. */
export const CLAUDE_CLI_SERVER_NAME = 'positron';
const PROXY_FILE_NAME = 'positron-mcp-proxy.mjs';
const MARKER_FILE_NAME = 'positron-mcp-claude-cli.json';

/**
 * Quote one argument for `cmd.exe`-mediated execution (the `claude` command
 * on Windows is an npm `.cmd` shim, which Node refuses to spawn without a
 * shell). Port of assistant PR #1520's quoteWinArg. Throws on `%`, which
 * cmd.exe expands unsafely inside quotes.
 */
export function quoteWinArg(arg: string): string {
	if (arg.includes('%')) {
		throw new Error(`Cannot safely quote argument containing '%' for cmd.exe: ${arg}`);
	}
	if (!/[\s&|^<>()"]/.test(arg)) {
		return arg;
	}
	// Double backslash runs that precede a quote, escape quotes, then wrap.
	let quoted = arg.replace(/(\\*)"/g, '$1$1\\"');
	quoted = quoted.replace(/(\\*)$/, '$1$1');
	return `"${quoted}"`;
}

/** Locate the `claude` CLI on PATH, or undefined when not installed. */
export async function findClaudeCli(): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(isWindows ? 'where' : 'which', ['claude']);
		const first = stdout.split(/\r?\n/).find(line => line.trim().length > 0);
		return first?.trim();
	} catch {
		return undefined;
	}
}

/** `claude mcp add` arguments registering the proxy at user scope. */
export function buildAddArgs(execPath: string, proxyPath: string): string[] {
	return ['mcp', 'add', CLAUDE_CLI_SERVER_NAME, '--scope', 'user', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', execPath, proxyPath];
}

export function buildRemoveArgs(): string[] {
	return ['mcp', 'remove', CLAUDE_CLI_SERVER_NAME, '--scope', 'user'];
}

/**
 * Write `content` to `targetPath` only when it differs, atomically (temp
 * sibling + rename) so a crash mid-write can never leave a truncated proxy
 * for an already-registered command to execute. Returns whether it wrote.
 */
export async function copyIfChanged(content: string, targetPath: string): Promise<boolean> {
	const existing = await fs.readFile(targetPath, 'utf8').catch(() => undefined);
	if (existing === content) {
		return false;
	}
	const tempPath = `${targetPath}.tmp`;
	await fs.writeFile(tempPath, content, 'utf8');
	await fs.rename(tempPath, targetPath);
	return true;
}

async function runClaude(claudePath: string, args: string[]): Promise<void> {
	if (isWindows) {
		// `shell: true` is required for .cmd shims; every argument must then be
		// quoted by hand because the whole line goes through cmd.exe parsing.
		await execFileAsync('claude', args.map(quoteWinArg), { shell: true });
	} else {
		await execFileAsync(claudePath, args);
	}
}

/** What the marker file records about the last successful registration. */
interface IRegistrationMarker {
	execPath: string;
	proxyPath: string;
}

export interface IClaudeCliRegistrationOptions {
	/** The user data directory holding the copied proxy and the marker. */
	userDataPath: string;
	/** Positron's own binary, run as node via ELECTRON_RUN_AS_NODE. */
	execPath: string;
	log: (message: string) => void;
}

/**
 * Ensure the proxy is copied out and registered with the Claude Code CLI.
 * Cheap when nothing changed: one `which` and one `claude mcp get` probe.
 */
export async function registerClaudeCli(options: IClaudeCliRegistrationOptions): Promise<ClaudeCliRegistrationState> {
	const claudePath = await findClaudeCli();
	if (!claudePath) {
		options.log('Claude Code CLI not found on PATH; skipping auto-registration');
		return 'not-found';
	}
	try {
		const proxyPath = join(options.userDataPath, PROXY_FILE_NAME);
		const markerPath = join(options.userDataPath, MARKER_FILE_NAME);
		const proxySource = FileAccess.asFileUri('vs/platform/positronMcp/node/positronMcpProxy.js').fsPath;
		const proxyContent = await fs.readFile(proxySource, 'utf8');
		const proxyChanged = await copyIfChanged(proxyContent, proxyPath);

		const marker: IRegistrationMarker = { execPath: options.execPath, proxyPath };
		const markerContent = JSON.stringify(marker);
		const markerCurrent = (await fs.readFile(markerPath, 'utf8').catch(() => undefined)) === markerContent;
		const alreadyRegistered = markerCurrent && !proxyChanged && await runClaude(claudePath, ['mcp', 'get', CLAUDE_CLI_SERVER_NAME]).then(() => true, () => false);
		if (alreadyRegistered) {
			return 'registered';
		}

		// `claude mcp add` errors on a duplicate name; a failing remove just
		// means it wasn't there.
		await runClaude(claudePath, buildRemoveArgs()).catch(() => { });
		await runClaude(claudePath, buildAddArgs(options.execPath, proxyPath));
		await fs.writeFile(markerPath, markerContent, 'utf8');
		options.log(`Registered the stdio proxy with the Claude Code CLI (${proxyPath})`);
		return 'registered';
	} catch (error) {
		options.log(`Failed to register with the Claude Code CLI: ${error instanceof Error ? error.message : String(error)}`);
		return 'error';
	}
}
