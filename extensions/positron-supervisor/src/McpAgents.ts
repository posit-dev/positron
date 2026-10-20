/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';

import {
	MCP_SERVER_NAME,
	MCP_TOKEN_ENV_VAR,
	MCP_URL_ENV_VAR,
} from './mcpConnection';

/**
 * How an agent starts Positron's MCP server: the `positron-mcp` launcher, which
 * finds the workspace the agent is working in and relays to its endpoint. The
 * command line names no port, no token, and no versioned install directory, so
 * an entry written with it stays correct across supervisor restarts and
 * Positron updates.
 */
export interface McpLaunch {
	readonly command: string;
	readonly args: readonly string[];
}

/**
 * The command line that starts the MCP bridge.
 *
 * @param launcherPath The launcher kept in the connections directory.
 * @returns The launch to write into an agent's configuration.
 */
export function mcpLaunch(launcherPath: string): McpLaunch {
	return { command: launcherPath, args: [] };
}

/** A harness Positron adds itself to by editing a configuration file. */
export interface McpFileInstall {
	readonly kind: 'file';

	/**
	 * The user's configuration file, as absolute path segments. A function
	 * because the environment can move it.
	 */
	readonly configPath: () => readonly string[];

	/** The file's format, which decides how an entry is merged into it. */
	readonly format: 'json' | 'toml';

	/** The dotted path the servers live under: `mcpServers`, `mcp_servers`. */
	readonly serversKey: string;

	/** The server entry, in the harness's own vocabulary. */
	readonly entry: (launch: McpLaunch) => Record<string, unknown>;
}

/** The entry most harnesses take: the command, and its arguments apart. */
function commandAndArgs(launch: McpLaunch): Record<string, unknown> {
	return { command: launch.command, args: [...launch.args] };
}

/**
 * A harness Positron adds itself to by running its CLI, which owns a
 * configuration Positron has no business editing by hand.
 */
export interface McpCliInstall {
	readonly kind: 'cli';

	/** The CLI's base name, looked up on the user's `PATH`. */
	readonly executable: string;

	/** Arguments that write Positron's entry. */
	readonly add: (launch: McpLaunch) => readonly string[];

	/** Arguments that take it out again. */
	readonly remove: readonly string[];
}

/** How Positron adds itself to a harness. */
export type McpInstall = McpFileInstall | McpCliInstall;

/** An agent harness Positron knows how to add itself to. */
export interface McpAgent {
	/** Stable identifier, which the configure command accepts as an argument. */
	readonly id: string;

	/** The harness's name, as it is shown to the user. */
	readonly label: string;

	/**
	 * The name the harness reports when it connects, when that name does not
	 * start with {@link id}.
	 */
	readonly clientName?: string;

	/** Either sign that the harness is installed. */
	readonly detect: { readonly executable?: string; readonly extensionId?: string };

	readonly install: McpInstall;
}

/**
 * The harnesses Positron can configure.
 *
 * Adding one is a row here plus nothing else: the command, the Quick Pick, and
 * the prompt that offers the feature all read this table.
 */
export const MCP_AGENTS: readonly McpAgent[] = [
	{
		id: 'claude-code',
		label: 'Claude Code',
		detect: { executable: 'claude', extensionId: 'anthropic.claude-code' },
		// Claude Code's own configuration for a directory, written through its
		// CLI. That scope stays out of the user's repository and needs no
		// approval on first use, and going through the CLI means there is one
		// mechanism -- rather than a file Positron writes and a CLI that writes
		// another -- to add the entry, replace it, and take it away again.
		install: {
			kind: 'cli',
			executable: 'claude',
			add: launch => [
				'mcp', 'add',
				'--scope', 'local',
				MCP_SERVER_NAME,
				'--',
				launch.command,
				...launch.args,
			],
			remove: ['mcp', 'remove', MCP_SERVER_NAME, '--scope', 'local'],
		},
	},
	{
		id: 'codex',
		label: 'Codex',
		detect: { executable: 'codex', extensionId: 'openai.chatgpt' },
		// Codex reads one configuration and has no per-project scope, which the
		// bridge copes with by finding the workspace from the directory Codex
		// runs in. That is also why this is a command the user runs rather than
		// something done for them: the entry follows Codex everywhere.
		install: {
			kind: 'file',
			configPath: () => [
				process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
				'config.toml',
			],
			format: 'toml',
			serversKey: 'mcp_servers',
			// Codex hands a server only an allowlist of its environment, so a
			// Codex started from a Positron terminal has to be told to pass the
			// endpoint on.
			entry: launch => ({
				...commandAndArgs(launch),
				env_vars: [MCP_URL_ENV_VAR, MCP_TOKEN_ENV_VAR],
			}),
		},
	},
	{
		id: 'gemini',
		label: 'Gemini CLI',
		detect: { executable: 'gemini', extensionId: 'google.gemini-cli-vscode-ide-companion' },
		// The user's settings rather than the workspace's: the entry names
		// paths on this machine, which do not belong in a repository.
		install: {
			kind: 'file',
			configPath: () => [os.homedir(), '.gemini', 'settings.json'],
			format: 'json',
			serversKey: 'mcpServers',
			entry: commandAndArgs,
		},
	},
	{
		id: 'kiro',
		label: 'Kiro',
		// Kiro still reports the name of the Amazon Q CLI it grew out of.
		clientName: 'Q DEV CLI',
		detect: { executable: 'kiro-cli' },
		// The user's MCP configuration, which the Kiro CLI and the Kiro IDE
		// share, rather than the workspace's, for the same reason as Gemini.
		install: {
			kind: 'file',
			configPath: () => [os.homedir(), '.kiro', 'settings', 'mcp.json'],
			format: 'json',
			serversKey: 'mcpServers',
			entry: commandAndArgs,
		},
	},
	{
		id: 'opencode',
		label: 'OpenCode',
		detect: { executable: 'opencode' },
		// The global configuration, for the same reason as Gemini. OpenCode's
		// CLI can add a server but not remove one, so the file is edited
		// directly.
		install: {
			kind: 'file',
			configPath: () => [
				process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
				'opencode',
				'opencode.json',
			],
			format: 'json',
			serversKey: 'mcp',
			entry: launch => ({ type: 'local', command: [launch.command, ...launch.args] }),
		},
	},
	{
		id: 'copilot',
		label: 'Copilot CLI',
		clientName: 'github-copilot-developer',
		detect: { executable: 'copilot' },
		// The user configuration, for the same reason as Gemini.
		install: {
			kind: 'file',
			configPath: () => [
				process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'),
				'mcp-config.json',
			],
			format: 'json',
			serversKey: 'mcpServers',
			entry: launch => ({ type: 'local', ...commandAndArgs(launch), tools: ['*'] }),
		},
	},
];

/**
 * Look up a harness by {@link McpAgent.id}.
 *
 * @param id The identifier to find.
 * @returns The harness, or undefined when nothing goes by that name.
 */
export function findMcpAgent(id: string): McpAgent | undefined {
	return MCP_AGENTS.find(agent => agent.id === id);
}

/**
 * Add Positron to a harness's configuration, preserving everything already in
 * it: the other servers, and the settings around them.
 *
 * @param install The file install being written.
 * @param existing The current contents of the file, if it exists.
 * @param launch The command line that starts the bridge.
 * @returns The contents to write.
 */
export function mergeAgentConfig(
	install: McpFileInstall,
	existing: string | undefined,
	launch: McpLaunch,
): string {
	const entry = install.entry(launch);
	return install.format === 'json'
		? mergeJsonConfig(existing, install.serversKey, entry)
		: mergeTomlConfig(existing, install.serversKey, entry);
}

/**
 * Take Positron out of a harness's configuration, leaving everything else in it
 * alone.
 *
 * @param install The file install being cleared.
 * @param existing The current contents of the file.
 * @returns The contents to write.
 */
export function unmergeAgentConfig(install: McpFileInstall, existing: string): string {
	return install.format === 'json'
		? unmergeJsonConfig(existing, install.serversKey)
		: unmergeTomlConfig(existing, install.serversKey);
}

/**
 * Merge the entry into a JSON configuration.
 *
 * @param existing The current contents, if the file exists.
 * @param serversKey The dotted path to the object the servers live under.
 * @param entry The entry from {@link McpFileInstall.entry}.
 * @returns The contents to write.
 */
function mergeJsonConfig(
	existing: string | undefined,
	serversKey: string,
	entry: Record<string, unknown>,
): string {
	const config: Record<string, unknown> = existing ? JSON.parse(existing) : {};
	let servers = config;
	for (const key of serversKey.split('.')) {
		servers = (servers[key] ?? (servers[key] = {})) as Record<string, unknown>;
	}
	servers[MCP_SERVER_NAME] = entry;
	return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Remove our entry from a JSON configuration.
 *
 * @param existing The current contents.
 * @param serversKey The dotted path to the object the servers live under.
 * @returns The contents to write.
 */
function unmergeJsonConfig(existing: string, serversKey: string): string {
	const config: Record<string, unknown> = JSON.parse(existing);
	const servers = serversKey.split('.').reduce<Record<string, unknown> | undefined>(
		(object, key) => object?.[key] as Record<string, unknown> | undefined, config);
	delete servers?.[MCP_SERVER_NAME];
	return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Merge the entry into a TOML configuration.
 *
 * Replaces our own table and moves nothing else, including the settings a user
 * put around it, so this stays a text edit rather than a parse and re-emit that
 * would lose their comments and formatting.
 *
 * @param existing The current contents, if the file exists.
 * @param serversKey The table the servers live under.
 * @param entry The entry from {@link McpFileInstall.entry}.
 * @returns The contents to write.
 */
export function mergeTomlConfig(
	existing: string | undefined,
	serversKey: string,
	entry: Record<string, unknown>,
): string {
	const own = `${serversKey}.${MCP_SERVER_NAME}`;
	const table = [
		`[${own}]`,
		...Object.entries(entry).map(([key, value]) => `${key} = ${tomlValue(value)}`),
		'',
	];

	const lines = existing?.split('\n') ?? [];
	const start = lines.findIndex(line => tableKey(line) === own);
	if (start < 0) {
		const before = existing?.replace(/\s+$/, '') ?? '';
		return before ? `${before}\n\n${table.join('\n')}` : table.join('\n');
	}

	// Our table runs to the next one, or to the end of the file.
	const rest = lines.slice(start + 1);
	const next = rest.findIndex(line => tableKey(line) !== undefined);
	return [
		...lines.slice(0, start),
		...table,
		...(next < 0 ? [] : rest.slice(next)),
	].join('\n');
}

/**
 * Remove our table from a TOML configuration.
 *
 * Takes the tables nested under ours with it -- the per-tool settings a user
 * may have added, say -- since a server left with nothing but those is one the
 * harness reports as broken, which is the state this is here to end.
 *
 * @param existing The current contents.
 * @param serversKey The table the servers live under.
 * @returns The contents to write.
 */
export function unmergeTomlConfig(existing: string, serversKey: string): string {
	const own = `${serversKey}.${MCP_SERVER_NAME}`;
	const lines = existing.split('\n');
	const start = lines.findIndex(line => tableKey(line) === own);
	if (start < 0) {
		return existing;
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex(line => {
		const key = tableKey(line);
		return key !== undefined && !key.startsWith(`${own}.`);
	});
	return [
		...lines.slice(0, start),
		...(next < 0 ? [] : rest.slice(next)),
	].join('\n');
}

/**
 * The key a TOML table header names, with quotes, whitespace, and any trailing
 * comment dropped, so `["mcp_servers" . positron] # mine` reads as
 * `mcp_servers.positron`.
 *
 * @param line A line of the file.
 * @returns The dotted key, or undefined when the line is not a table header.
 */
function tableKey(line: string): string | undefined {
	const match = /^\s*\[\[?(?<key>[^\[\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
	const parts = match?.groups!.key.split('.').map(part => part.trim());
	if (!parts?.every(part => /^(?:[\w-]+|"[^"]*"|'[^']*')$/.test(part))) {
		return undefined;
	}
	return parts.map(part => part.replace(/^(["'])(?<inner>.*)\1$/, '$<inner>')).join('.');
}

/**
 * A value as TOML spells it: basic strings, so a Windows path's backslashes
 * survive, and arrays for a command's arguments.
 */
function tomlValue(value: unknown): string {
	return Array.isArray(value) ? `[${value.map(tomlValue).join(', ')}]` : JSON.stringify(value);
}
