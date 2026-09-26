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
	MCP_AGENTS,
	McpAgent,
	McpCliInstall,
	McpFileInstall,
	McpLaunch,
	findMcpAgent,
	mergeAgentConfig,
	unmergeAgentConfig,
} from './McpAgents';
import { AI_ENABLED_KEY, MCP_ENABLED_KEY, mcpFeatureEnabled } from './McpFrontend';
import { summarizeError } from './util';

/** Runs a command without a shell, rejecting on a non-zero exit. */
const execFileAsync = promisify(execFile);

/** Where the MCP server is documented. */
const MCP_DOCS_URL = 'https://positron.posit.co/mcp-server';

/** Command that adds the server to a coding agent's configuration. */
export const CONFIGURE_AGENT_COMMAND = 'positron.mcp.configureAgent';

/** Remembers that the one-time offer to turn the feature on has been made. */
const ENABLE_PROMPT_SHOWN_KEY = 'positron-supervisor.mcp.enablePromptShown';

/**
 * Remembers which harnesses Positron has written into. Kept in workspace state,
 * because Claude Code's entry is keyed by this workspace's directory.
 */
const CONFIGURED_AGENTS_KEY = 'positron-supervisor.mcp.configuredAgents';

/** The harness configured for a user who only turned the feature on. */
const AUTO_CONFIGURED_AGENT_ID = 'claude-code';

/**
 * One harness Positron has written into, and what it was told.
 *
 * Recorded so an entry can be put right when the bridge moves -- a Positron
 * update in a versioned install directory, say -- and taken away when the
 * feature is turned off.
 */
interface ConfiguredAgent {
	/** The harness's {@link McpAgent.id}. */
	id: string;

	/**
	 * The command line the entry was written with. Absent from records written
	 * before agents were configured to start the bridge, whose entries are
	 * rewritten on the next registration.
	 */
	launch?: McpLaunch;
}

/** Where an installed entry landed, for the message that says so. */
interface InstallResult {
	/** The location, as it is shown to the user. */
	description: string;

	/** The file Positron wrote, when it wrote one rather than running a CLI. */
	file?: vscode.Uri;
}

/**
 * Adds Positron to a coding agent's configuration, replacing any entry of ours
 * already there so that running it again is a repair rather than a second
 * entry.
 *
 * @param context The extension context, which remembers what we configure.
 * @param launch The command line that starts the bridge.
 * @param agentId The harness to configure. Omitted when the user ran the
 *  command from the palette, in which case they are asked to pick one.
 */
export async function configureAgent(
	context: vscode.ExtensionContext,
	launch: () => McpLaunch,
	agentId?: string,
): Promise<void> {
	if (!mcpFeatureEnabled()) {
		await warnNotRunning();
		return;
	}

	const agent = agentId ? findMcpAgent(agentId) : await pickAgent();
	if (!agent) {
		return;
	}

	let result: InstallResult;
	let written: McpLaunch;
	try {
		written = launch();
		result = await installAgent(agent, written);
	} catch (err) {
		await vscode.window.showErrorMessage(summarizeError(err));
		return;
	}
	await recordConfiguredAgent(context, agent, written);

	const open = vscode.l10n.t("Open File");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			"Added Positron to {0} in {1}. Restart {0} so it picks up the change.",
			agent.label,
			result.description),
		...(result.file ? [open] : []));

	if (choice === open && result.file) {
		await vscode.window.showTextDocument(result.file);
	}
}

/**
 * Bring the harnesses we have configured in line with a registration that has
 * just been issued, and configure Claude Code if this is the first one.
 *
 * Runs after a registration succeeds, so an agent configured here finds the
 * workspace listening. Reports its own failures rather than raising them:
 * registration is complete by the time it runs, and nothing waits on it.
 *
 * @param context The extension context, which remembers what we configure.
 * @param launch The command line that starts the bridge.
 * @param log Writes a line to the Kernel Supervisor output channel.
 */
export async function onMcpRegistered(
	context: vscode.ExtensionContext,
	launch: () => McpLaunch,
	log: (message: string) => void,
): Promise<void> {
	try {
		const current = launch();
		await autoConfigureClaudeCode(context, current, log);
		await refreshConfiguredAgents(context, current, log);
	} catch (err) {
		log(`Could not update the configured coding agents: ${summarizeError(err)}`);
	}
}

/**
 * Adds Positron to Claude Code's configuration for this workspace, so that
 * turning the feature on is all a user has to do.
 *
 * The entry goes in Claude Code's own configuration for the directory rather
 * than the workspace's `.mcp.json`: it stays out of the user's repository, and
 * it needs no approval on first use, since a user who enabled the feature has
 * already said yes.
 *
 * No other harness has an equivalent per-project scope, so the rest keep to
 * {@link configureAgent}: writing a global configuration would follow the user
 * into projects that have nothing to do with Positron.
 *
 * @param context The extension context, which remembers what we configure.
 * @param launch The command line that starts the bridge.
 * @param log Writes a line to the Kernel Supervisor output channel.
 */
async function autoConfigureClaudeCode(
	context: vscode.ExtensionContext,
	launch: McpLaunch,
	log: (message: string) => void,
): Promise<void> {
	const agent = findMcpAgent(AUTO_CONFIGURED_AGENT_ID);
	if (!agent) {
		return;
	}

	// Configured once per workspace: a user who removes the entry again does
	// not get it back.
	if (loadConfiguredAgents(context).some(record => record.id === agent.id)) {
		return;
	}

	// Nothing is recorded when there is no folder or no CLI, so installing
	// Claude Code later still gets it configured.
	if (!fileWorkspaceFolder() || !installExecutable(agent)) {
		return;
	}

	try {
		const { description } = await installAgent(agent, launch);
		log(`Configured ${agent.label} to use Positron's MCP server in ${description}`);
	} catch (err) {
		log(`Could not configure ${agent.label}: ${summarizeError(err)}`);
		return;
	}
	await recordConfiguredAgent(context, agent, launch);
}

/**
 * Rewrite the entries whose command line has since moved.
 *
 * An entry names the supervisor binary, which moves when Positron is updated in
 * a versioned install directory, and when a developer switches between builds.
 *
 * @param context The extension context, which remembers what we configure.
 * @param launch The command line that starts the bridge.
 * @param log Writes a line to the Kernel Supervisor output channel.
 */
async function refreshConfiguredAgents(
	context: vscode.ExtensionContext,
	launch: McpLaunch,
	log: (message: string) => void,
): Promise<void> {
	const records = loadConfiguredAgents(context);
	let changed = false;
	for (const record of records) {
		const agent = findMcpAgent(record.id);
		if (!agent || sameLaunch(record.launch, launch)) {
			continue;
		}
		try {
			await installAgent(agent, launch);
		} catch (err) {
			log(`Could not update ${agent.label}'s MCP entry: ${summarizeError(err)}`);
			continue;
		}
		record.launch = launch;
		changed = true;
		log(`Updated ${agent.label}'s MCP entry to start ${launch.command}`);
	}
	if (changed) {
		await saveConfiguredAgents(context, records);
	}
}

/**
 * Take Positron out of every harness we wrote into.
 *
 * Runs when the feature is turned off, so that agents stop offering the user
 * tools that can only report that Positron is not reachable.
 *
 * @param context The extension context, which remembers what we configure.
 * @param log Writes a line to the Kernel Supervisor output channel.
 */
export async function removeConfiguredAgents(
	context: vscode.ExtensionContext,
	log: (message: string) => void,
): Promise<void> {
	const records = loadConfiguredAgents(context);
	if (records.length === 0) {
		return;
	}

	// A harness whose entry we could not remove stays on the list, so turning
	// the feature off again retries it.
	const kept: ConfiguredAgent[] = [];
	for (const record of records) {
		const agent = findMcpAgent(record.id);
		if (!agent) {
			continue;
		}
		try {
			await uninstallAgent(agent);
			log(`Removed Positron from ${agent.label}`);
		} catch (err) {
			log(`Could not remove Positron from ${agent.label}: ${summarizeError(err)}`);
			kept.push(record);
		}
	}
	await saveConfiguredAgents(context, kept);
}

/**
 * Whether a harness is installed, by either of the signs its row names.
 *
 * @param agent The harness to look for.
 * @returns True when the CLI is on the path or the extension is present.
 */
function detectAgent(agent: McpAgent): boolean {
	const { executable, extensionId } = agent.detect;
	return (!!executable && !!resolveOnPath(executable)) ||
		(!!extensionId && !!vscode.extensions.getExtension(extensionId));
}

/**
 * How to invoke an agent CLI without going through a shell. Windows cannot
 * execute a batch launcher directly, so those run under `cmd.exe`.
 *
 * @param executable The full path to the CLI.
 * @param args The arguments to pass to it.
 * @returns The command and arguments to spawn.
 */
export function agentCliCommand(
	executable: string,
	args: readonly string[],
): { command: string; args: string[] } {
	if (/\.(cmd|bat)$/i.test(executable)) {
		return { command: 'cmd.exe', args: ['/c', executable, ...args] };
	}
	return { command: executable, args: [...args] };
}

/**
 * Offers to turn the feature on, once per user, when an agent that can use it
 * is installed. Does nothing when AI features are off, when the feature is
 * already on, when no agent is installed, or when the offer has been made
 * before.
 *
 * @param context The extension context, which remembers that we have asked.
 */
export async function promptToEnable(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration();
	// The main AI switch sits above the feature's own switch, and an
	// administrator can enforce it off, so there is nothing to offer when it
	// is off.
	if (config.get<boolean>(AI_ENABLED_KEY) !== true) {
		return;
	}
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
 * Whether two command lines are the same.
 *
 * @param a A recorded command line, if one was recorded.
 * @param b The current one.
 */
function sameLaunch(a: McpLaunch | undefined, b: McpLaunch): boolean {
	return !!a && a.command === b.command &&
		a.args.length === b.args.length && a.args.every((arg, i) => arg === b.args[i]);
}

/**
 * Write Positron's entry into a harness's configuration.
 *
 * @param agent The harness being configured.
 * @param launch The command line that starts the bridge.
 * @returns Where the entry landed.
 * @throws An error whose message is fit to show the user.
 */
async function installAgent(agent: McpAgent, launch: McpLaunch): Promise<InstallResult> {
	return agent.install.kind === 'cli'
		? installViaCli(agent, agent.install, launch)
		: installViaFile(agent.install, launch);
}

/** Add the entry by running the harness's CLI. */
async function installViaCli(
	agent: McpAgent,
	install: McpCliInstall,
	launch: McpLaunch,
): Promise<InstallResult> {
	const folder = fileWorkspaceFolder();
	if (!folder) {
		throw new Error(vscode.l10n.t(
			"Open a folder before adding Positron to {0}, which keeps a configuration per directory.",
			agent.label));
	}
	const executable = resolveOnPath(install.executable);
	if (!executable) {
		throw new Error(vscode.l10n.t(
			"Could not find {0} on the path. Install it, then run this command again.",
			install.executable));
	}

	// Remove any entry of ours first: the CLI refuses to add a server that is
	// already there, and one written by an older Positron may be wrong rather
	// than merely present.
	try {
		await runAgentCli(executable, install.remove, folder);
	} catch {
		// There was nothing of ours to remove, which is the common case.
	}
	await runAgentCli(executable, install.add(launch), folder);

	return { description: vscode.workspace.asRelativePath(folder) };
}

/** Add the entry by editing the harness's configuration file. */
async function installViaFile(
	install: McpFileInstall,
	launch: McpLaunch,
): Promise<InstallResult> {
	const target = agentConfigUri(install);
	const existing = await readFileIfPresent(target);
	let contents: string;
	try {
		contents = mergeAgentConfig(install, existing, launch);
	} catch (err) {
		// Refuse rather than overwrite a file we could not understand.
		throw new Error(vscode.l10n.t(
			"Could not update {0}: {1}",
			target.fsPath,
			summarizeError(err)));
	}
	await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));

	return { description: target.fsPath, file: target };
}

/**
 * Take Positron's entry out of a harness's configuration, leaving the rest of
 * it as it was.
 *
 * @param agent The harness to clear.
 * @throws An error when a configuration file could not be rewritten, so the
 *  harness stays on the list and is tried again.
 */
async function uninstallAgent(agent: McpAgent): Promise<void> {
	if (agent.install.kind === 'cli') {
		const folder = fileWorkspaceFolder();
		const executable = installExecutable(agent);
		if (!folder || !executable) {
			// The CLI is gone, and with it the configuration it kept.
			return;
		}
		try {
			await runAgentCli(executable, agent.install.remove, folder);
		} catch {
			// The CLI reports an entry that is not there as a failure, and it
			// is the only authority on a configuration it owns, so there is
			// nothing to tell apart and nothing left to try.
		}
		return;
	}

	const target = agentConfigUri(agent.install);
	const existing = await readFileIfPresent(target);
	if (existing === undefined) {
		return;
	}
	const contents = unmergeAgentConfig(agent.install, existing);
	if (contents !== existing) {
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));
	}
}

/**
 * Run a harness's CLI in a workspace folder.
 *
 * @param executable The full path to the CLI.
 * @param args The arguments to pass to it.
 * @param folder The directory to run in, which is what the CLI keys its
 *  configuration by.
 */
async function runAgentCli(
	executable: string,
	args: readonly string[],
	folder: vscode.Uri,
): Promise<void> {
	const command = agentCliCommand(executable, args);
	await execFileAsync(command.command, command.args, { cwd: folder.fsPath });
}

/** The harness's CLI, when its row installs through one and it is on the path. */
function installExecutable(agent: McpAgent): string | undefined {
	return agent.install.kind === 'cli' ? resolveOnPath(agent.install.executable) : undefined;
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

/** The harnesses Positron has written into, in the order they were configured. */
function loadConfiguredAgents(context: vscode.ExtensionContext): ConfiguredAgent[] {
	return context.workspaceState.get<ConfiguredAgent[]>(CONFIGURED_AGENTS_KEY) ?? [];
}

function saveConfiguredAgents(
	context: vscode.ExtensionContext,
	records: ConfiguredAgent[],
): Thenable<void> {
	return context.workspaceState.update(CONFIGURED_AGENTS_KEY, records);
}

/**
 * Remember what a harness was told, replacing what we knew about it, so that
 * configuring one twice leaves one record rather than two.
 *
 * @param context The extension context.
 * @param agent The harness that was configured.
 * @param launch The command line its entry was written with.
 */
function recordConfiguredAgent(
	context: vscode.ExtensionContext,
	agent: McpAgent,
	launch: McpLaunch,
): Thenable<void> {
	const records = loadConfiguredAgents(context).filter(record => record.id !== agent.id);
	records.push({ id: agent.id, launch });
	return saveConfiguredAgents(context, records);
}

/**
 * The file a harness's row points at.
 *
 * @param install The file install being written.
 * @returns The file.
 */
function agentConfigUri(install: McpFileInstall): vscode.Uri {
	return vscode.Uri.file(path.join(...install.configPath()));
}

/**
 * The workspace folder a harness's configuration belongs to: the first one, on
 * a filesystem the agent shares with us.
 *
 * @returns The folder, or undefined when there is none we can write into.
 */
function fileWorkspaceFolder(): vscode.Uri | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder?.uri.scheme === 'file' ? folder.uri : undefined;
}

/**
 * Read a file, treating one that is not there as nothing rather than an error.
 *
 * @param file The file to read.
 * @returns The contents, or undefined when the file does not exist.
 */
async function readFileIfPresent(file: vscode.Uri): Promise<string | undefined> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
	} catch {
		return undefined;
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

/** Explains that there is nothing to configure yet. */
async function warnNotRunning(): Promise<void> {
	await vscode.window.showWarningMessage(vscode.l10n.t(
		"Positron's MCP server is not running. Turn on the '{0}' setting to start it.",
		MCP_ENABLED_KEY));
}
