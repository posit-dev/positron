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
	McpConnection,
} from './mcpConnection';

/**
 * How a harness spells an HTTP MCP server. Every harness records the same three
 * facts -- where the servers live, what the endpoint is called, and what the
 * transport is called -- under names of its own.
 */
export interface McpDialect {
	/** The file's format, which decides how an entry is merged into it. */
	readonly format: 'json' | 'toml';

	/** What the servers live under: `mcpServers`, `servers`, `mcp_servers`. */
	readonly serversKey: string;

	/** What the endpoint is called: `url`, `httpUrl`, `serverUrl`. */
	readonly urlKey: string;

	/**
	 * What the transport is called and how it is spelled -- `http`,
	 * `streamable-http`, `streamableHttp` -- for the harnesses that ask for it.
	 * Omitted by the ones that infer it from the endpoint's key.
	 */
	readonly transport?: { readonly key: string; readonly value: string };
}

/** How a harness is handed the workspace's bearer token. */
export type TokenDelivery =
	/**
	 * The harness expands `${VAR}` in its configuration, so the file names
	 * neither the token nor the port: it is safe to commit and survives a
	 * restart that moves the endpoint.
	 */
	| { readonly kind: 'env' }
	/**
	 * The harness runs a command that prints its headers, configured under
	 * `key`. The endpoint is written out as well, since a harness that will not
	 * expand a variable for the token will not expand one for the URL either.
	 */
	| { readonly kind: 'command'; readonly key: string };

/** A harness Positron adds itself to by editing a configuration file. */
export interface McpFileInstall {
	readonly kind: 'file';

	/** Which of the harness's configurations the entry belongs in. */
	readonly scope: 'workspace' | 'global';

	/**
	 * The configuration file, as path segments: relative to the workspace root
	 * for a `workspace` harness, absolute for a `global` one. A function
	 * because a global location can be moved by the environment.
	 */
	readonly configPath: () => readonly string[];

	readonly dialect: McpDialect;

	readonly tokenDelivery: TokenDelivery;
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
	readonly add: readonly string[];

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
			add: [
				'mcp', 'add',
				'--transport', 'http',
				'--scope', 'local',
				MCP_SERVER_NAME,
				`\${${MCP_URL_ENV_VAR}}`,
				'--header', `Authorization: Bearer \${${MCP_TOKEN_ENV_VAR}}`,
			],
			remove: ['mcp', 'remove', MCP_SERVER_NAME, '--scope', 'local'],
		},
	},
	{
		id: 'codex',
		label: 'Codex',
		detect: { executable: 'codex', extensionId: 'openai.chatgpt' },
		// Codex reads one configuration and has no per-project scope, so a file
		// in the workspace would be ignored. That is also why this is a command
		// the user runs rather than something done for them: the entry follows
		// Codex into projects that have nothing to do with Positron, where the
		// endpoint refuses it rather than answering for the wrong workspace.
		install: {
			kind: 'file',
			scope: 'global',
			configPath: () => [
				process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
				'config.toml',
			],
			dialect: { format: 'toml', serversKey: 'mcp_servers', urlKey: 'url' },
			tokenDelivery: { kind: 'command', key: 'http_headers_helper' },
		},
	},
	{
		id: 'gemini',
		label: 'Gemini CLI',
		detect: { executable: 'gemini', extensionId: 'google.gemini-cli-vscode-ide-companion' },
		install: {
			kind: 'file',
			scope: 'workspace',
			configPath: () => ['.gemini', 'settings.json'],
			// `httpUrl` is Gemini's streamable HTTP endpoint; naming it is what
			// selects the transport, so there is nothing else to say.
			dialect: { format: 'json', serversKey: 'mcpServers', urlKey: 'httpUrl' },
			tokenDelivery: { kind: 'env' },
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
 * Whether a harness's entry names the endpoint itself, and so has to be
 * rewritten when the endpoint moves. The harnesses that expand a variable for
 * it need nothing: the environment they read is republished on every
 * registration.
 *
 * @param agent The harness to test.
 * @returns True when the entry holds a URL rather than a variable.
 */
export function pinsEndpoint(agent: McpAgent): boolean {
	return agent.install.kind === 'file' && agent.install.tokenDelivery.kind === 'command';
}

/**
 * The command a harness runs to get the workspace's `Authorization` header.
 *
 * The output has to be a JSON object of headers -- exactly what Positron writes
 * into the file -- so printing the file is the whole job. The command runs
 * through the platform's shell, which is why Windows gets `type` rather than
 * `cat`.
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
 * The server entry to write, in the harness's own vocabulary.
 *
 * @param install The file install being written.
 * @param connection The live MCP registration.
 * @returns The fields of the entry, in the order they should be written.
 */
export function mcpServerEntry(
	install: McpFileInstall,
	connection: McpConnection,
): Record<string, unknown> {
	const { dialect, tokenDelivery } = install;
	const entry: Record<string, unknown> = {};
	if (dialect.transport) {
		entry[dialect.transport.key] = dialect.transport.value;
	}
	if (tokenDelivery.kind === 'env') {
		entry[dialect.urlKey] = `\${${MCP_URL_ENV_VAR}}`;
		entry.headers = { Authorization: `Bearer \${${MCP_TOKEN_ENV_VAR}}` };
	} else {
		// The workspace ID and port in the URL are the ones Positron asks the
		// supervisor to reuse, so writing it out still survives a restart.
		entry[dialect.urlKey] = connection.url;
		entry[tokenDelivery.key] = headersHelperCommand(connection.headersPath);
	}
	return entry;
}

/**
 * Add Positron to a harness's configuration, preserving everything already in
 * it: the other servers, and the settings around them.
 *
 * @param install The file install being written.
 * @param existing The current contents of the file, if it exists.
 * @param connection The live MCP registration.
 * @returns The contents to write.
 */
export function mergeAgentConfig(
	install: McpFileInstall,
	existing: string | undefined,
	connection: McpConnection,
): string {
	const entry = mcpServerEntry(install, connection);
	return install.dialect.format === 'json'
		? mergeJsonConfig(existing, install.dialect.serversKey, entry)
		: mergeTomlConfig(existing, install.dialect.serversKey, entry);
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
	return install.dialect.format === 'json'
		? unmergeJsonConfig(existing, install.dialect.serversKey)
		: unmergeTomlConfig(existing, install.dialect.serversKey);
}

/**
 * Merge the entry into a JSON configuration.
 *
 * @param existing The current contents, if the file exists.
 * @param serversKey The object the servers live under.
 * @param entry The entry from {@link mcpServerEntry}.
 * @returns The contents to write.
 */
export function mergeJsonConfig(
	existing: string | undefined,
	serversKey: string,
	entry: Record<string, unknown>,
): string {
	const config: Record<string, unknown> = existing ? JSON.parse(existing) : {};
	const servers = (config[serversKey] ?? (config[serversKey] = {})) as Record<string, unknown>;
	servers[MCP_SERVER_NAME] = entry;
	return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Remove our entry from a JSON configuration.
 *
 * @param existing The current contents.
 * @param serversKey The object the servers live under.
 * @returns The contents to write.
 */
export function unmergeJsonConfig(existing: string, serversKey: string): string {
	const config: Record<string, unknown> = JSON.parse(existing);
	const servers = config[serversKey] as Record<string, unknown> | undefined;
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
 * @param entry The entry from {@link mcpServerEntry}.
 * @returns The contents to write.
 */
export function mergeTomlConfig(
	existing: string | undefined,
	serversKey: string,
	entry: Record<string, unknown>,
): string {
	const header = `[${serversKey}.${MCP_SERVER_NAME}]`;
	const table = [
		header,
		...Object.entries(entry).map(([key, value]) => `${key} = ${tomlValue(value)}`),
		'',
	];

	const lines = existing?.split('\n') ?? [];
	const start = lines.findIndex(line => line.trim() === header);
	if (start < 0) {
		const before = existing?.replace(/\s+$/, '') ?? '';
		return before ? `${before}\n\n${table.join('\n')}` : table.join('\n');
	}

	// Our table runs to the next one, or to the end of the file.
	const rest = lines.slice(start + 1);
	const next = rest.findIndex(line => line.trimStart().startsWith('['));
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
	const header = `[${serversKey}.${MCP_SERVER_NAME}]`;
	const nested = `[${serversKey}.${MCP_SERVER_NAME}.`;
	const lines = existing.split('\n');
	const start = lines.findIndex(line => line.trim() === header);
	if (start < 0) {
		return existing;
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex(line => {
		const trimmed = line.trimStart();
		return trimmed.startsWith('[') && !trimmed.startsWith(nested);
	});
	return [
		...lines.slice(0, start),
		...(next < 0 ? [] : rest.slice(next)),
	].join('\n');
}

/**
 * A value as TOML spells it: basic strings, so a Windows path's backslashes
 * survive, and inline tables for the nested headers a harness may ask for.
 */
function tomlValue(value: unknown): string {
	if (typeof value !== 'object' || value === null) {
		return JSON.stringify(value);
	}
	const fields = Object.entries(value as Record<string, unknown>)
		.map(([key, field]) => `${key} = ${tomlValue(field)}`);
	return `{ ${fields.join(', ')} }`;
}
