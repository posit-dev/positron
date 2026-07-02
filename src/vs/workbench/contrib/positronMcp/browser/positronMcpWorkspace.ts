/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { POSITRON_MCP_DEFAULT_PORT } from '../../../../platform/positronMcp/common/positronMcp.js';

/** Whether the first workspace folder has an `.mcp.json` with a positron entry. */
export type WorkspaceConfigState = 'configured' | 'not-configured' | 'no-workspace';

/** The URL clients use to reach the server, surfaced in the UI and written to `.mcp.json`. */
export function serverUrl(port: number = POSITRON_MCP_DEFAULT_PORT): string {
	return `http://localhost:${port}`;
}

/**
 * Merge a `positron` HTTP server entry into the parsed contents of an `.mcp.json`
 * file, preserving any other servers and top-level keys. Pure so the merge logic
 * is unit-testable without touching the file system. Returns the object to write.
 */
export function mergeMcpConfig(existing: unknown, port: number = POSITRON_MCP_DEFAULT_PORT): Record<string, unknown> {
	const config: Record<string, unknown> = (existing && typeof existing === 'object') ? { ...existing as Record<string, unknown> } : {};
	const servers = (config.mcpServers && typeof config.mcpServers === 'object')
		? { ...config.mcpServers as Record<string, unknown> }
		: {};
	servers.positron = { type: 'http', url: serverUrl(port) };
	config.mcpServers = servers;
	return config;
}

/** Whether a parsed `.mcp.json` object already has a positron server entry. */
export function hasPositronServer(parsed: unknown): boolean {
	if (!parsed || typeof parsed !== 'object') {
		return false;
	}
	const servers = (parsed as Record<string, unknown>).mcpServers;
	return !!servers && typeof servers === 'object' && (servers as Record<string, unknown>).positron !== undefined;
}

/**
 * Reads and writes the `.mcp.json` config and agent-guidance files in the first
 * workspace folder, and reports the workspace's MCP-config state. The `.mcp.json`
 * merge and guidance-append logic live in the pure functions above; this class
 * is the thin file-system shell around them.
 */
export class PositronMcpWorkspace {
	constructor(
		private readonly _fileService: IFileService,
		private readonly _workspaceContextService: IWorkspaceContextService,
	) { }

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

	/** Whether the first folder has an `.mcp.json` with a positron entry. */
	async getConfigState(): Promise<WorkspaceConfigState> {
		const folder = this._firstFolder();
		if (!folder) {
			return 'no-workspace';
		}
		const parsed = await this._readJson(URI.joinPath(folder, '.mcp.json'));
		return hasPositronServer(parsed) ? 'configured' : 'not-configured';
	}

	/**
	 * Per-file guidance state: for each agent-instruction file, whether it already
	 * carries the guidance marker. Lets the status panel render each file as a
	 * checked row or an inline add action, instead of one all-files-or-nothing
	 * button. All files report absent when no folder is open.
	 */
	async getGuidanceState(): Promise<IGuidanceFileState[]> {
		const folder = this._firstFolder();
		return Promise.all(GUIDANCE_FILES.map(async file => {
			if (!folder) {
				return { file, present: false };
			}
			try {
				const content = (await this._fileService.readFile(URI.joinPath(folder, file))).value.toString();
				return { file, present: content.includes(GUIDANCE_MARKER) };
			} catch {
				return { file, present: false };
			}
		}));
	}

	/**
	 * Create or update the first folder's `.mcp.json` so it points at the server,
	 * preserving any other servers it already lists. Returns the file path on
	 * success, or undefined when no folder is open.
	 */
	async writeMcpConfig(port?: number): Promise<string | undefined> {
		const folder = this._firstFolder();
		if (!folder) {
			return undefined;
		}
		const uri = URI.joinPath(folder, '.mcp.json');
		const merged = mergeMcpConfig(await this._readJson(uri), port);
		await this._fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(merged, null, 2) + '\n'));
		return uri.fsPath;
	}

	/**
	 * Append the MCP usage note to an agent-instruction file (creating it if
	 * needed), unless the marker is already present. Returns the file URI when it
	 * was changed (so the caller can open it), or undefined when nothing changed
	 * or no folder is open.
	 */
	async appendGuidance(fileName: GuidanceFile): Promise<URI | undefined> {
		const folder = this._firstFolder();
		if (!folder) {
			return undefined;
		}
		const uri = URI.joinPath(folder, fileName);
		let existing = '';
		try {
			existing = (await this._fileService.readFile(uri)).value.toString();
		} catch {
			// File does not exist yet -- it will be created.
		}
		if (existing.includes(GUIDANCE_MARKER)) {
			return undefined;
		}
		await this._fileService.writeFile(uri, VSBuffer.fromString(existing + appendedGuidanceBlock(existing)));
		return uri;
	}
}

/** The agent-instruction files the guidance command writes and checks. */
export const GUIDANCE_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/** One agent-instruction file the guidance command manages. */
export type GuidanceFile = typeof GUIDANCE_FILES[number];

/** Whether one agent-instruction file already carries the guidance marker. */
export interface IGuidanceFileState {
	readonly file: GuidanceFile;
	readonly present: boolean;
}

// A marker comment so re-running the guidance command is idempotent.
const GUIDANCE_MARKER = '<!-- positron-mcp -->';
const GUIDANCE_TEXT = 'This workspace has a Positron MCP server available. Use its `positron` MCP tools to run code, inspect variables and data, create plots, and edit notebooks in the user\'s live Positron session -- prefer them over your own shell for any data exploration or modeling work. Work step by step, running and checking each step in the session, rather than writing one big script and sourcing it.';

/** The guidance block to append, with a separator matching the file's current trailing whitespace. */
function appendedGuidanceBlock(existing: string): string {
	const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
	return `${separator}${GUIDANCE_MARKER}\n${GUIDANCE_TEXT}\n`;
}
