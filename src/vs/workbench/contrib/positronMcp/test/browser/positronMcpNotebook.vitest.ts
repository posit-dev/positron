/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileStatWithMetadata, IFileService } from '../../../../../platform/files/common/files.js';
import { IResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronMcpNotebookTools } from '../../browser/positronMcpNotebook.js';

describe('PositronMcpNotebookTools', () => {
	const resolvePath = (p: string) => URI.file(p.startsWith('/') ? p : `/workspace/${p}`);

	/** Tools wired with no active notebook (the editor pane is not a notebook). */
	function withoutNotebook() {
		const editorService = stubInterface<IEditorService>({ activeEditorPane: undefined });
		const fileService = stubInterface<IFileService>({});
		return new PositronMcpNotebookTools(editorService, fileService, resolvePath);
	}

	describe('guards when no notebook is open', () => {
		it('read/edit/runCells all report that no notebook is open', async () => {
			const tools = withoutNotebook();
			const noConsent = async () => { throw new Error('consent should not be requested'); };
			const message = 'No notebook is open in the editor. Open a notebook, then try again.';
			expect(await tools.read({})).toBe(message);
			expect(await tools.edit({ editMode: 'delete', cellIndex: 0 }, noConsent)).toBe(message);
			expect(await tools.runCells({ cellIndices: [0] }, noConsent)).toBe(message);
		});
	});

	describe('create', () => {
		/** Tools with a writable file system and a notebook editor that opens cleanly. */
		function withFileSystem(exists: boolean) {
			// openEditor is overloaded, so a typed vi.fn() can't match it; capture the
			// argument the tool passes for assertion instead.
			let openedWith: IResourceEditorInput | undefined;
			const openEditor = vi.fn((editor: IResourceEditorInput) => { openedWith = editor; return Promise.resolve(undefined); });
			const writeFile = vi.fn<IFileService['writeFile']>(async () => stubInterface<IFileStatWithMetadata>());
			const editorService = stubInterface<IEditorService>({ openEditor: openEditor as unknown as IEditorService['openEditor'] });
			const fileService = stubInterface<IFileService>({ exists: vi.fn(async () => exists), writeFile });
			const tools = new PositronMcpNotebookTools(editorService, fileService, resolvePath);
			return { tools, getOpenedWith: () => openedWith, writeFile };
		}

		it('rejects a path without a .ipynb extension', async () => {
			const { tools } = withFileSystem(false);
			await expect(tools.create({ path: 'analysis.py', language: 'python' })).rejects.toThrow('.ipynb');
		});

		it('rejects an unsupported language', async () => {
			const { tools } = withFileSystem(false);
			await expect(tools.create({ path: 'nb.ipynb', language: 'julia' })).rejects.toThrow('Unsupported language');
		});

		it('rejects when the file already exists', async () => {
			const { tools } = withFileSystem(true);
			await expect(tools.create({ path: 'nb.ipynb', language: 'python' })).rejects.toThrow('already exists');
		});

		it('writes the notebook and opens it in the Positron editor', async () => {
			const { tools, getOpenedWith, writeFile } = withFileSystem(false);
			const result = await tools.create({ path: 'nb.ipynb', language: 'python' });

			expect(result).toContain('Created empty python notebook');
			// The written content is a valid empty Jupyter notebook with the kernelspec.
			const written = JSON.parse((writeFile.mock.calls[0][1] as VSBuffer).toString());
			expect(written).toMatchObject({ cells: [], nbformat: 4, metadata: { kernelspec: { name: 'python3' } } });
			// It is opened with the Positron notebook editor override.
			expect(getOpenedWith()).toMatchObject({ options: { override: 'workbench.editor.positronNotebook' } });
		});
	});
});
