/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import {
	MCP_ENABLED_KEY,
	MCP_TOKEN_ENV_VAR,
	MCP_URL_ENV_VAR,
	McpConnection,
} from './McpFrontend';
import { summarizeError } from './util';

/** Runs a command without a shell, rejecting on a non-zero exit. */
const execFileAsync = promisify(execFile);

/** Where the MCP server is documented. */
export const MCP_DOCS_URL = 'https://positron.posit.co/mcp-server';

/** The name agents see the server under, and prefix its tools with. */
export const MCP_SERVER_NAME = 'positron';

/** Command that adds the server to the workspace's Claude Code configuration. */
export const ADD_TO_CLAUDE_CODE_COMMAND = 'positron.mcp.addToClaudeCode';

/** Command that adds the server to the workspace's Codex configuration. */
export const ADD_TO_CODEX_COMMAND = 'positron.mcp.addToCodex';

/** Remembers that the one-time offer to turn the feature on has been made. */
const ENABLE_PROMPT_SHOWN_KEY = 'positron-supervisor.mcp.enablePromptShown';

/**
 * Remembers that this workspace's Claude Code configuration has been written,
 * so a user who removes the server again does not get it back.
 */
const AUTO_CONFIGURED_KEY = 'positron-supervisor.mcp.claudeCodeConfigured';

/** Adds Positron to the configuration Claude Code keeps for a directory. */
export const CLAUDE_MCP_ADD_ARGS = [
	'mcp', 'add',
	'--transport', 'http',
	'--scope', 'local',
	MCP_SERVER_NAME,
	`\${${MCP_URL_ENV_VAR}}`,
	'--header', `Authorization: Bearer \${${MCP_TOKEN_ENV_VAR}}`,
];

/** The agent CLIs whose presence prompts us to offer the feature. */
const AGENT_EXECUTABLES = ['claude', 'codex'];

/**
 * Adds Positron to a Claude Code configuration, preserving the servers already
 * in it.
 *
 * The entry refers to the endpoint and token by environment variable, which
 * Claude Code expands, so the file holds no secret and no port: it is safe to
 * commit and stays correct across restarts.
 *
 * @param existing The current contents of `.mcp.json`, if the file exists.
 * @returns The contents to write.
 */
export function mergeClaudeCodeConfig(existing: string | undefined): string {
	const config: { mcpServers?: Record<string, unknown> } = existing ? JSON.parse(existing) : {};
	const servers = config.mcpServers ?? (config.mcpServers = {});
	servers[MCP_SERVER_NAME] = {
		type: 'http',
		url: `\${${MCP_URL_ENV_VAR}}`,
		headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV_VAR}}` },
	};
	return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The arguments that add Positron to Codex's configuration, replacing any
 * entry already under the name.
 *
 * Codex does not expand variables in `url`, so the endpoint is written out; its
 * workspace ID and port are the ones Positron asks the supervisor to reuse, so
 * it survives restarts. The token is not named here at all: the CLI can only
 * point Codex at an environment variable, and Codex's own extension spawns it
 * without one. {@link insertHeadersHelper} adds the way it does get the token.
 *
 * @param url The MCP endpoint URL.
 * @returns The arguments to pass to the Codex CLI.
 */
export function codexMcpAddArgs(url: string): string[] {
	return [
		'mcp', 'add',
		MCP_SERVER_NAME,
		'--url', url,
	];
}

/**
 * The command Codex runs to get the workspace's `Authorization` header.
 *
 * Codex reads the command's output, which has to be a JSON object of headers --
 * exactly what Positron writes into the file -- so printing the file is the
 * whole job. The command runs through the platform's shell, which is why
 * Windows gets `type` rather than `cat`.
 *
 * @param headersPath The file Positron wrote the header to.
 * @returns The shell command line.
 */
export function headersHelperCommand(headersPath: string): string {
	return os.platform() === 'win32'
		? `type "${headersPath}"`
		: `cat '${headersPath.replace(/'/g, `'\\''`)}'`;
}

/**
 * Points the entry `codex mcp add` has just written at the headers helper.
 *
 * The CLI has no flag for it, and refuses to keep a `-c` override, so the key
 * is written in directly. That is safe to do by hand here and nowhere else: the
 * CLI has just rewritten this one table from scratch, leaving the rest of the
 * file alone, so the line after its header is the top of an entry we know the
 * shape of.
 *
 * @param config The contents of Codex's `config.toml`.
 * @param helper The command from {@link headersHelperCommand}.
 * @returns The contents to write back.
 */
export function insertHeadersHelper(config: string, helper: string): string {
	const lines = config.split('\n');
	const header = `[mcp_servers.${MCP_SERVER_NAME}]`;
	const index = lines.findIndex(line => line.trim() === header);
	if (index < 0) {
		throw new Error(`Could not find ${header} in the Codex configuration.`);
	}
	// A TOML basic string, so a Windows path's backslashes survive.
	const value = JSON.stringify(helper);
	return [
		...lines.slice(0, index + 1),
		`http_headers_helper = ${value}`,
		...lines.slice(index + 1),
	].join('\n');
}

/** Codex's one configuration file. */
function codexConfigPath(): string {
	return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

/**
 * Writes the Claude Code configuration for the current registration into the
 * workspace's `.mcp.json`, where it can be committed and shared with a team.
 * Agents on this machine are already configured by
 * {@link autoConfigureClaudeCode}.
 *
 * @param connection The live MCP registration, or undefined when the feature
 *  is off.
 */
export async function addToClaudeCode(connection: McpConnection | undefined): Promise<void> {
	await writeAgentConfig(
		connection,
		['.mcp.json'],
		'Claude Code',
		existing => mergeClaudeCodeConfig(existing));
}

/**
 * Adds Positron to Codex's configuration.
 *
 * Codex reads one configuration, `$CODEX_HOME/config.toml`, and has no
 * per-project scope, so there is nothing to write into the workspace: a file
 * there would be ignored. That is also why this is a command the user runs
 * rather than something done for them, as it is for Claude Code -- the entry
 * follows Codex into projects that have nothing to do with Positron, where the
 * endpoint refuses it rather than answering for the wrong workspace.
 *
 * @param connection The live MCP registration, or undefined when the feature
 *  is off.
 */
export async function addToCodex(connection: McpConnection | undefined): Promise<void> {
	if (!connection) {
		await warnNotRunning();
		return;
	}

	const executable = resolveOnPath('codex');
	if (!executable) {
		await vscode.window.showErrorMessage(vscode.l10n.t(
			"Could not find the Codex CLI on the path. Install Codex, then run this command again."));
		return;
	}

	const { command, args } = agentCliCommand(executable, codexMcpAddArgs(connection.url));
	const configPath = codexConfigPath();
	try {
		await execFileAsync(command, args);
		const config = await fs.promises.readFile(configPath, 'utf8');
		await fs.promises.writeFile(
			configPath,
			insertHeadersHelper(config, headersHelperCommand(connection.headersPath)));
	} catch (err) {
		await vscode.window.showErrorMessage(vscode.l10n.t(
			"Could not configure Codex: {0}",
			summarizeError(err)));
		return;
	}

	await vscode.window.showInformationMessage(vscode.l10n.t(
		"Added Positron to Codex. Open a new terminal, or reload the window if you use the Codex extension, so it picks up the connection."));
}

/**
 * How to invoke an agent CLI without going through a shell. Windows cannot
 * execute a batch launcher directly, so those run under `cmd.exe`, which leaves
 * `${...}` alone: it expands `%VAR%`.
 *
 * @param executable The full path to the CLI.
 * @param args The arguments to pass to it.
 * @returns The command and arguments to spawn.
 */
export function agentCliCommand(
	executable: string,
	args: string[],
): { command: string; args: string[] } {
	if (/\.(cmd|bat)$/i.test(executable)) {
		return { command: 'cmd.exe', args: ['/c', executable, ...args] };
	}
	return { command: executable, args };
}

/**
 * Adds Positron to Claude Code's configuration for this workspace, so that
 * turning the feature on is all a user has to do.
 *
 * The entry goes in Claude Code's own project-local configuration rather than
 * the workspace's `.mcp.json`: it stays out of the user's repository, and it
 * needs no approval on first use, since a user who enabled the feature has
 * already said yes. Runs once per workspace, after a registration succeeds, so
 * we never point an agent at an endpoint that is not listening.
 *
 * Codex has no equivalent per-project scope, so it keeps to
 * {@link addToCodex}: writing its global configuration would follow the user
 * into projects that have nothing to do with Positron.
 *
 * @param context The extension context, which remembers the workspaces we have
 *  configured.
 * @param log Writes a line to the Kernel Supervisor output channel.
 */
export async function autoConfigureClaudeCode(
	context: vscode.ExtensionContext,
	log: (message: string) => void,
): Promise<void> {
	if (context.workspaceState.get<boolean>(AUTO_CONFIGURED_KEY)) {
		return;
	}

	// Claude Code keys the configuration by directory, so there has to be one,
	// on a filesystem the CLI shares with us.
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder?.uri.scheme !== 'file') {
		return;
	}

	// Leave the workspace unmarked when the CLI is missing, so installing it
	// later still gets it configured.
	const executable = resolveOnPath('claude');
	if (!executable) {
		return;
	}

	const { command, args } = agentCliCommand(executable, CLAUDE_MCP_ADD_ARGS);
	try {
		await execFileAsync(command, args, { cwd: folder.uri.fsPath });
		log(`Configured Claude Code to use Positron's MCP server in ${folder.uri.fsPath}`);
	} catch (err) {
		// Claude Code fails when the server is already configured, which means
		// there is nothing to do. Anything else leaves the workspace unmarked
		// so that the next registration tries again.
		const message = summarizeError(err);
		if (!message.includes('already exists')) {
			log(`Could not configure Claude Code: ${message}`);
			return;
		}
	}

	await context.workspaceState.update(AUTO_CONFIGURED_KEY, true);
}

/**
 * Offers to turn the feature on, once per user, when an agent CLI that can use
 * it is installed. Does nothing when the feature is already on, when no agent
 * is installed, or when the offer has been made before.
 *
 * @param context The extension context, which remembers that we have asked.
 */
export async function promptToEnable(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration();
	if (config.get<boolean>(MCP_ENABLED_KEY) !== false) {
		return;
	}
	if (context.globalState.get<boolean>(ENABLE_PROMPT_SHOWN_KEY)) {
		return;
	}
	const agent = AGENT_EXECUTABLES.find(executable => resolveOnPath(executable));
	if (!agent) {
		return;
	}
	await context.globalState.update(ENABLE_PROMPT_SHOWN_KEY, true);

	const enable = vscode.l10n.t("Enable");
	const learnMore = vscode.l10n.t("Learn More");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Positron can let {0} run code in this window's Python and R sessions. Enable it?",
			agent),
		enable,
		learnMore);

	if (choice === enable) {
		await config.update(MCP_ENABLED_KEY, true, vscode.ConfigurationTarget.Global);
	} else if (choice === learnMore) {
		await vscode.env.openExternal(vscode.Uri.parse(MCP_DOCS_URL));
	}
}

/**
 * Finds an executable on the user's `PATH`. Cheaper and quieter than spawning
 * the agent to ask it, and gives us a path we can run without a shell.
 *
 * @param executable The executable's base name.
 * @returns The full path, or undefined when it is not installed.
 */
function resolveOnPath(executable: string): string | undefined {
	const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	const names = os.platform() === 'win32'
		? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map(ext => executable + ext)
		: [executable];
	for (const directory of directories) {
		for (const name of names) {
			const candidate = path.join(directory, name);
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

/**
 * Merges the server into a configuration file in the workspace and tells the
 * user where it landed.
 *
 * @param connection The live registration, or undefined when the feature is off.
 * @param relativePath The file's path segments, relative to the workspace root.
 * @param agentName The agent whose configuration this is, for messages.
 * @param merge Produces the new contents from the old.
 */
async function writeAgentConfig(
	connection: McpConnection | undefined,
	relativePath: string[],
	agentName: string,
	merge: (existing: string | undefined) => string,
): Promise<void> {
	if (!connection) {
		await warnNotRunning();
		return;
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		await vscode.window.showErrorMessage(vscode.l10n.t(
			"Open a folder before adding Positron to {0}; the configuration is written into the workspace.",
			agentName));
		return;
	}

	const target = vscode.Uri.joinPath(folder.uri, ...relativePath);
	let existing: string | undefined;
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
	} catch {
		// The file does not exist yet, which is the common case.
	}

	let contents: string;
	try {
		contents = merge(existing);
	} catch (err) {
		// Refuse rather than overwrite a file we could not understand.
		await vscode.window.showErrorMessage(vscode.l10n.t(
			"Could not update {0}: {1}",
			vscode.workspace.asRelativePath(target),
			summarizeError(err)));
		return;
	}

	await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));

	const open = vscode.l10n.t("Open File");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Added Positron to {0}. Open a new terminal so {1} picks up the connection.",
			vscode.workspace.asRelativePath(target),
			agentName),
		open);

	if (choice === open) {
		await vscode.window.showTextDocument(target);
	}
}

/** Explains that there is nothing to configure yet. */
async function warnNotRunning(): Promise<void> {
	await vscode.window.showWarningMessage(vscode.l10n.t(
		"Positron's MCP server is not running. Turn on the '{0}' setting to start it.",
		MCP_ENABLED_KEY));
}
