/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileContent, IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronMcpWorkspace, hasPositronServer, mergeMcpConfig, serverUrl } from '../../browser/positronMcpWorkspace.js';

describe('positronMcp workspace helpers', () => {
	describe('mergeMcpConfig', () => {
		it('adds a positron http entry to an empty config', () => {
			expect(mergeMcpConfig(undefined, 43123)).toEqual({
				mcpServers: { positron: { type: 'http', url: 'http://localhost:43123' } },
			});
		});

		it('preserves other servers and top-level keys', () => {
			const existing = { otherKey: 1, mcpServers: { another: { type: 'http', url: 'http://localhost:9999' } } };
			expect(mergeMcpConfig(existing)).toEqual({
				otherKey: 1,
				mcpServers: {
					another: { type: 'http', url: 'http://localhost:9999' },
					positron: { type: 'http', url: serverUrl() },
				},
			});
		});
	});

	describe('hasPositronServer', () => {
		it('detects the positron entry and rejects everything else', () => {
			expect(hasPositronServer({ mcpServers: { positron: {} } })).toBe(true);
			expect(hasPositronServer({ mcpServers: { other: {} } })).toBe(false);
			expect(hasPositronServer({})).toBe(false);
			expect(hasPositronServer(undefined)).toBe(false);
		});
	});

	/** A workspace with one folder and an in-memory `.mcp.json` (or none). */
	function workspace(folder: URI | undefined, files: Map<string, string>) {
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
		return { instance: new PositronMcpWorkspace(fileService, workspaceContextService), files, writeFile };
	}

	const FOLDER = URI.file('/workspace');
	const CONFIG = URI.joinPath(FOLDER, '.mcp.json').toString();

	describe('getConfigState', () => {
		it('reports no-workspace, not-configured, and configured', async () => {
			expect(await workspace(undefined, new Map()).instance.getConfigState()).toBe('no-workspace');
			expect(await workspace(FOLDER, new Map()).instance.getConfigState()).toBe('not-configured');
			const configured = new Map([[CONFIG, JSON.stringify({ mcpServers: { positron: { type: 'http' } } })]]);
			expect(await workspace(FOLDER, configured).instance.getConfigState()).toBe('configured');
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
			expect(written.mcpServers).toMatchObject({ other: { url: 'http://localhost:1' }, positron: { type: 'http' } });
		});
	});

	describe('appendGuidance', () => {
		const GUIDANCE = URI.joinPath(FOLDER, 'CLAUDE.md').toString();

		it('creates the file with the guidance block and returns its uri', async () => {
			const { instance, files } = workspace(FOLDER, new Map());
			const uri = await instance.appendGuidance('CLAUDE.md');
			expect(uri?.toString()).toBe(GUIDANCE);
			expect(files.get(GUIDANCE)).toContain('<!-- positron-mcp -->');
		});

		it('is a no-op when the marker is already present', async () => {
			const files = new Map([[GUIDANCE, '# Notes\n\n<!-- positron-mcp -->\nexisting\n']]);
			const { instance, writeFile } = workspace(FOLDER, files);
			expect(await instance.appendGuidance('CLAUDE.md')).toBeUndefined();
			expect(writeFile).not.toHaveBeenCalled();
		});
	});
});
