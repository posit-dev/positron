/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileContent, IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { IPositronMcpService, IPositronMcpWindowStatus } from '../../../../../platform/positronMcp/common/positronMcp.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronMcpWorkspace, mergeMcpConfig, positronServerState, serverUrl } from '../../browser/positronMcpWorkspace.js';

const TOKEN = 'test-token-0123456789abcdef-0123456789abcdef';
const AUTH = `Bearer ${TOKEN}`;

describe('positronMcp workspace helpers', () => {
	describe('mergeMcpConfig', () => {
		it('adds a positron http entry with the auth header to an empty config', () => {
			expect(mergeMcpConfig(undefined, TOKEN, 43123)).toEqual({
				mcpServers: { positron: { type: 'http', url: 'http://localhost:43123', headers: { Authorization: AUTH } } },
			});
		});

		it('preserves other servers and top-level keys', () => {
			const existing = { otherKey: 1, mcpServers: { another: { type: 'http', url: 'http://localhost:9999' } } };
			expect(mergeMcpConfig(existing, TOKEN)).toEqual({
				otherKey: 1,
				mcpServers: {
					another: { type: 'http', url: 'http://localhost:9999' },
					positron: { type: 'http', url: serverUrl(), headers: { Authorization: AUTH } },
				},
			});
		});

		it('replaces a stale positron entry with the current token', () => {
			const existing = { mcpServers: { positron: { type: 'http', url: serverUrl(43123), headers: { Authorization: 'Bearer old-token' } } } };
			expect(positronServerState(mergeMcpConfig(existing, TOKEN, 43123), TOKEN, 43123)).toBe('configured');
		});
	});

	describe('positronServerState', () => {
		const withUrl = (headers: object) => ({ mcpServers: { positron: { type: 'http', url: serverUrl(43123), headers } } });

		it('reports configured only when the entry carries both the current port and the current token', () => {
			// Port and token both match.
			expect(positronServerState(withUrl({ Authorization: AUTH }), TOKEN, 43123)).toBe('configured');
			// Port matches, token doesn't (rotated-out or hand-edited token).
			expect(positronServerState(withUrl({ Authorization: 'Bearer other' }), TOKEN, 43123)).toBe('stale');
			expect(positronServerState({ mcpServers: { positron: { type: 'http', url: serverUrl(43123) } } }, TOKEN, 43123)).toBe('stale');
			// Token matches, port doesn't (routinely true after a restart: each
			// window's server binds a fresh ephemeral port).
			expect(positronServerState(withUrl({ Authorization: AUTH }), TOKEN, 50000)).toBe('stale');
			// Neither matches.
			expect(positronServerState(withUrl({ Authorization: 'Bearer other' }), TOKEN, 50000)).toBe('stale');
			expect(positronServerState({ mcpServers: { positron: null } }, TOKEN, 43123)).toBe('stale');
			expect(positronServerState({ mcpServers: { other: {} } }, TOKEN, 43123)).toBe('not-configured');
			expect(positronServerState({}, TOKEN, 43123)).toBe('not-configured');
			expect(positronServerState(undefined, TOKEN, 43123)).toBe('not-configured');
		});
	});

	/** A workspace with one folder and an in-memory `.mcp.json` (or none). */
	function workspace(folder: URI | undefined, files: Map<string, string>, port = 43123) {
		const readFile = vi.fn<IFileService['readFile']>(async (resource: URI): Promise<IFileContent> => {
			const content = files.get(resource.toString());
			if (content === undefined) {
				throw new FileOperationError('not found', FileOperationResult.FILE_NOT_FOUND);
			}
			return stubInterface<IFileContent>({ value: VSBuffer.fromString(content) });
		});
		const writeFile = vi.fn<IFileService['writeFile']>(async (resource: URI, buffer): Promise<IFileStatWithMetadata> => {
			files.set(resource.toString(), (buffer as VSBuffer).toString());
			return stubInterface<IFileStatWithMetadata>();
		});
		const fileService = stubInterface<IFileService>({ readFile, writeFile });
		const workspaceContextService = stubInterface<IWorkspaceContextService>({
			getWorkspace: () => stubInterface<ReturnType<IWorkspaceContextService['getWorkspace']>>({
				folders: folder ? [stubInterface<ReturnType<IWorkspaceContextService['getWorkspace']>['folders'][number]>({ uri: folder })] : [],
			}),
		});
		const mcpService = stubInterface<IPositronMcpService>({
			getStatus: async () => stubInterface<IPositronMcpWindowStatus>({ token: TOKEN, port }),
		});
		return { instance: new PositronMcpWorkspace(fileService, workspaceContextService, mcpService), files, writeFile };
	}

	const FOLDER = URI.file('/workspace');
	const CONFIG = URI.joinPath(FOLDER, '.mcp.json').toString();

	describe('getConfigState', () => {
		it('reports no-workspace, not-configured, stale, and configured', async () => {
			expect(await workspace(undefined, new Map()).instance.getConfigState()).toBe('no-workspace');
			expect(await workspace(FOLDER, new Map()).instance.getConfigState()).toBe('not-configured');
			// A pre-token entry no longer authenticates, so it is not "configured".
			const stale = new Map([[CONFIG, JSON.stringify({ mcpServers: { positron: { type: 'http' } } })]]);
			expect(await workspace(FOLDER, stale).instance.getConfigState()).toBe('stale');
			const configured = new Map([[CONFIG, JSON.stringify({ mcpServers: { positron: { type: 'http', url: serverUrl(43123), headers: { Authorization: AUTH } } } })]]);
			expect(await workspace(FOLDER, configured).instance.getConfigState()).toBe('configured');
		});

		it('goes stale after a restart changes the port, even with a valid token', async () => {
			// A previously-written entry pointing at the port from a prior run --
			// routine now that each window's server binds a fresh ephemeral port.
			const entry = new Map([[CONFIG, JSON.stringify({ mcpServers: { positron: { type: 'http', url: serverUrl(43123), headers: { Authorization: AUTH } } } })]]);
			expect(await workspace(FOLDER, entry, 50000).instance.getConfigState()).toBe('stale');
		});
	});

	describe('writeMcpConfig', () => {
		it('returns undefined with no workspace open', async () => {
			expect(await workspace(undefined, new Map()).instance.writeMcpConfig()).toBeUndefined();
		});

		it('merges into an existing file without dropping other servers', async () => {
			const files = new Map([[CONFIG, JSON.stringify({ mcpServers: { other: { type: 'http', url: 'http://localhost:1' } } })]]);
			const { instance } = workspace(FOLDER, files);
			await instance.writeMcpConfig();
			const written = JSON.parse(files.get(CONFIG)!);
			expect(written.mcpServers).toMatchObject({
				other: { url: 'http://localhost:1' },
				positron: { type: 'http', headers: { Authorization: AUTH } },
			});
		});

		it('writes the server-reported port, not the default', async () => {
			const files = new Map<string, string>();
			const { instance } = workspace(FOLDER, files, 50000);
			await instance.writeMcpConfig();
			const written = JSON.parse(files.get(CONFIG)!);
			expect(written.mcpServers.positron.url).toBe('http://localhost:50000');
		});
	});
});
