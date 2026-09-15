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

/** An agent harness Positron knows how to add itself to. */
export interface McpAgent {
	/** Stable identifier, which the configure command accepts as an argument. */
	readonly id: string;

	/** The harness's name, as it is shown to the user. */
	readonly label: string;

	/** Either sign that the harness is installed. */
	readonly detect: { readonly executable?: string; readonly extensionId?: string };

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
		// Written into the workspace, where it can be committed and shared with
		// a team. Agents on this machine are configured without being asked;
		// see `autoConfigureClaudeCode`.
		scope: 'workspace',
		configPath: () => ['.mcp.json'],
		dialect: {
			format: 'json',
			serversKey: 'mcpServers',
			urlKey: 'url',
			transport: { key: 'type', value: 'http' },
		},
		tokenDelivery: { kind: 'env' },
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
		scope: 'global',
		configPath: () => [
			process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
			'config.toml',
		],
		dialect: { format: 'toml', serversKey: 'mcp_servers', urlKey: 'url' },
		tokenDelivery: { kind: 'command', key: 'http_headers_helper' },
	},
	{
		id: 'gemini',
		label: 'Gemini CLI',
		detect: { executable: 'gemini', extensionId: 'google.gemini-cli-vscode-ide-companion' },
		scope: 'workspace',
		configPath: () => ['.gemini', 'settings.json'],
		// `httpUrl` is Gemini's streamable HTTP endpoint; naming it is what
		// selects the transport, so there is nothing else to say.
		dialect: { format: 'json', serversKey: 'mcpServers', urlKey: 'httpUrl' },
		tokenDelivery: { kind: 'env' },
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
 * @param agent The harness being configured.
 * @param connection The live MCP registration.
 * @returns The fields of the entry, in the order they should be written.
 */
export function mcpServerEntry(agent: McpAgent, connection: McpConnection): Record<string, unknown> {
	const { dialect, tokenDelivery } = agent;
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
 * @param agent The harness being configured.
 * @param existing The current contents of the file, if it exists.
 * @param connection The live MCP registration.
 * @returns The contents to write.
 */
export function mergeAgentConfig(
	agent: McpAgent,
	existing: string | undefined,
	connection: McpConnection,
): string {
	const entry = mcpServerEntry(agent, connection);
	return agent.dialect.format === 'json'
		? mergeJsonConfig(existing, agent.dialect.serversKey, entry)
		: mergeTomlConfig(existing, agent.dialect.serversKey, entry);
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
