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

import { MCP_AGENTS, MCP_SERVER_NAME, McpAgent, findMcpAgent, mergeAgentConfig } from './McpAgents';
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

/** Command that adds the server to a coding agent's configuration. */
export const CONFIGURE_AGENT_COMMAND = 'positron.mcp.configureAgent';

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

/**
 * Adds Positron to a coding agent's configuration.
 *
 * @param connection The live MCP registration, or undefined when the feature
 *  is off.
 * @param agentId The harness to configure. Omitted when the user ran the
 *  command from the palette, in which case they are asked to pick one.
 */
export async function configureAgent(
	connection: McpConnection | undefined,
	agentId?: string,
): Promise<void> {
	if (!connection) {
		await warnNotRunning();
		return;
	}

	const agent = agentId ? findMcpAgent(agentId) : await pickAgent();
	if (!agent) {
		return;
	}

	const target = agentConfigUri(agent);
	if (!target) {
		await vscode.window.showErrorMessage(vscode.l10n.t(
			"Open a folder before adding Positron to {0}; the configuration is written into the workspace.",
			agent.label));
		return;
	}

	let existing: string | undefined;
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
	} catch {
		// The file does not exist yet, which is the common case.
	}

	let contents: string;
	try {
		contents = mergeAgentConfig(agent, existing, connection);
	} catch (err) {
		// Refuse rather than overwrite a file we could not understand.
		await vscode.window.showErrorMessage(vscode.l10n.t(
			"Could not update {0}: {1}",
			target.fsPath,
			summarizeError(err)));
		return;
	}

	await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));

	const open = vscode.l10n.t("Open File");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Added Positron to {0} in {1}. Open a new terminal, or reload the window if {0} runs as an extension, so it picks up the connection.",
			agent.label,
			agent.scope === 'workspace' ? vscode.workspace.asRelativePath(target) : target.fsPath),
		open);

	if (choice === open) {
		await vscode.window.showTextDocument(target);
	}
}

/**
 * Whether a harness is installed, by either of the signs its row names.
 *
 * @param agent The harness to look for.
 * @returns True when the CLI is on the path or the extension is present.
 */
export function detectAgent(agent: McpAgent): boolean {
	const { executable, extensionId } = agent.detect;
	return (!!executable && !!resolveOnPath(executable)) ||
		(!!extensionId && !!vscode.extensions.getExtension(extensionId));
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
 * No other harness has an equivalent per-project scope, so the rest keep to
 * {@link configureAgent}: writing a global configuration would follow the user
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
 * Offers to turn the feature on, once per user, when an agent that can use it
 * is installed. Does nothing when the feature is already on, when no agent is
 * installed, or when the offer has been made before.
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
	const agent = MCP_AGENTS.find(detectAgent);
	if (!agent) {
		return;
	}
	await context.globalState.update(ENABLE_PROMPT_SHOWN_KEY, true);

	const enable = vscode.l10n.t("Enable");
	const learnMore = vscode.l10n.t("Learn More");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Positron can let {0} run code in this window's Python and R sessions. Enable it?",
			agent.label),
		enable,
		learnMore);

	if (choice === enable) {
		await config.update(MCP_ENABLED_KEY, true, vscode.ConfigurationTarget.Global);
	} else if (choice === learnMore) {
		await vscode.env.openExternal(vscode.Uri.parse(MCP_DOCS_URL));
	}
}

/**
 * Asks which harness to configure, offering the installed ones first.
 *
 * The ones we cannot find are still offered: a user who is about to install one
 * gets a configuration waiting for it, rather than a dead end.
 *
 * @returns The harness the user chose, or undefined when they dismissed it.
 */
async function pickAgent(): Promise<McpAgent | undefined> {
	const items = MCP_AGENTS
		.map(agent => ({
			label: agent.label,
			description: detectAgent(agent) ? vscode.l10n.t("Installed") : undefined,
			agent,
		}))
		.sort((a, b) => Number(!!b.description) - Number(!!a.description));

	const choice = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t("Add Positron to a Coding Agent"),
		placeHolder: vscode.l10n.t("Select the agent to configure"),
	});
	return choice?.agent;
}

/**
 * The file a harness's row points at.
 *
 * @param agent The harness being configured.
 * @returns The file, or undefined when a workspace-scoped harness has no
 *  workspace to write into.
 */
function agentConfigUri(agent: McpAgent): vscode.Uri | undefined {
	const segments = agent.configPath();
	if (agent.scope === 'global') {
		return vscode.Uri.file(path.join(...segments));
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder && vscode.Uri.joinPath(folder.uri, ...segments);
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

/** Explains that there is nothing to configure yet. */
async function warnNotRunning(): Promise<void> {
	await vscode.window.showWarningMessage(vscode.l10n.t(
		"Positron's MCP server is not running. Turn on the '{0}' setting to start it.",
		MCP_ENABLED_KEY));
}
