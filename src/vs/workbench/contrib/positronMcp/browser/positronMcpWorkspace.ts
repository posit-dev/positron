/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IPositronMcpService, POSITRON_MCP_DEFAULT_PORT } from '../../../../platform/positronMcp/common/positronMcp.js';

/**
 * The state of the first workspace folder's `.mcp.json` positron entry.
 * 'stale' means an entry exists but does not carry the current bearer token
 * (written before tokens existed, or after a token regeneration), so the
 * server would reject its requests with 401 until it is re-written.
 */
export type WorkspaceConfigState = 'configured' | 'stale' | 'not-configured' | 'no-workspace';

/** The URL clients use to reach the server, surfaced in the UI and written to `.mcp.json`. */
export function serverUrl(port: number = POSITRON_MCP_DEFAULT_PORT): string {
	return `http://localhost:${port}`;
}

/** The literal `Authorization` header value carrying the server's bearer token. */
export function bearerHeader(token: string): string {
	return `Bearer ${token}`;
}

/**
 * Merge a `positron` HTTP server entry into the parsed contents of an `.mcp.json`
 * file, preserving any other servers and top-level keys. Pure so the merge logic
 * is unit-testable without touching the file system. Returns the object to write.
 */
export function mergeMcpConfig(existing: unknown, token: string, port: number = POSITRON_MCP_DEFAULT_PORT): Record<string, unknown> {
	const config: Record<string, unknown> = (existing && typeof existing === 'object') ? { ...existing as Record<string, unknown> } : {};
	const servers = (config.mcpServers && typeof config.mcpServers === 'object')
		? { ...config.mcpServers as Record<string, unknown> }
		: {};
	// The token is written literally (accepted risk: the file can be committed;
	// the token is only useful for local requests on this user's machine).
	servers.positron = { type: 'http', url: serverUrl(port), headers: { Authorization: bearerHeader(token) } };
	config.mcpServers = servers;
	return config;
}

/**
 * The state of the positron server entry in a parsed `.mcp.json` object:
 * 'missing' when there is none, 'stale' when it lacks the current bearer
 * token, 'configured' when it would authenticate.
 */
export function positronServerState(parsed: unknown, token: string): 'configured' | 'stale' | 'missing' {
	if (!parsed || typeof parsed !== 'object') {
		return 'missing';
	}
	const servers = (parsed as Record<string, unknown>).mcpServers;
	if (!servers || typeof servers !== 'object') {
		return 'missing';
	}
	const positron = (servers as Record<string, unknown>).positron;
	if (positron === undefined) {
		return 'missing';
	}
	const headers = (positron && typeof positron === 'object') ? (positron as Record<string, unknown>).headers : undefined;
	const authorization = (headers && typeof headers === 'object') ? (headers as Record<string, unknown>).Authorization : undefined;
	return authorization === bearerHeader(token) ? 'configured' : 'stale';
}

/**
 * Reads and writes the `.mcp.json` config in the first workspace folder, and
 * reports the workspace's MCP-config state. The `.mcp.json` merge logic lives
 * in the pure functions above; this class is the thin file-system shell around
 * them, plus the fetch of the server's bearer token and port (both stable for
 * the process lifetime, so they are fetched once and cached).
 */
export class PositronMcpWorkspace {
	private _server: Promise<{ token: string; port: number }> | undefined;

	constructor(
		private readonly _fileService: IFileService,
		private readonly _workspaceContextService: IWorkspaceContextService,
		private readonly _mcpService: IPositronMcpService,
	) { }

	/** The server's token and port, fetched once per instance. */
	private _serverInfo(): Promise<{ token: string; port: number }> {
		return this._server ??= this._mcpService.getStatus().then(({ token, port }) => ({ token, port }));
	}

	/** The first workspace folder's URI, or undefined if no folder is open. */
	private _firstFolder(): URI | undefined {
		return this._workspaceContextService.getWorkspace().folders[0]?.uri;
	}

	/** Read and JSON-parse a file, or undefined if it is missing or unparseable. */
	private async _readJson(uri: URI): Promise<unknown> {
		try {
			const content = await this._fileService.readFile(uri);
			return JSON.parse(content.value.toString());
		} catch {
			return undefined;
		}
	}

	/** The state of the first folder's `.mcp.json` positron entry. */
	async getConfigState(): Promise<WorkspaceConfigState> {
		const folder = this._firstFolder();
		if (!folder) {
			return 'no-workspace';
		}
		const parsed = await this._readJson(URI.joinPath(folder, '.mcp.json'));
		switch (positronServerState(parsed, (await this._serverInfo()).token)) {
			case 'configured': return 'configured';
			case 'stale': return 'stale';
			case 'missing': return 'not-configured';
		}
	}

	/**
	 * Create or update the first folder's `.mcp.json` so it points at the server
	 * with the current bearer token, preserving any other servers it already
	 * lists. Returns the file path on success, or undefined when no folder is
	 * open.
	 */
	async writeMcpConfig(): Promise<string | undefined> {
		const folder = this._firstFolder();
		if (!folder) {
			return undefined;
		}
		const uri = URI.joinPath(folder, '.mcp.json');
		const { token, port } = await this._serverInfo();
		const merged = mergeMcpConfig(await this._readJson(uri), token, port);
		await this._fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(merged, null, 2) + '\n'));
		return uri.fsPath;
	}
}
