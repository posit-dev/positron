/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { IFileStatWithMetadata, IFileService } from '../../../../../platform/files/common/files.js';
import { IResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IMcpCallToolResult } from '../../../../../platform/positronMcp/common/positronMcpTools.js';
import { EditorsOrder, IEditorIdentifier } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IOutputItemDto } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell, NotebookCellOutputs } from '../../../positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookService } from '../../../positronNotebook/browser/positronNotebookService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronMcpNotebookTools } from '../../browser/positronMcpNotebook.js';

describe('PositronMcpNotebookTools', () => {
	const resolvePath = (p: string) => URI.file(p.startsWith('/') ? p : `/workspace/${p}`);

	/** The text of a tool result's first text block. */
	function textOf(result: IMcpCallToolResult): string {
		const block = result.content.find(c => c.type === 'text');
		return block?.type === 'text' ? block.text : '';
	}

	/** A one-cell markdown notebook instance open at the given path. */
	function notebookInstance(path: string, content: string): IPositronNotebookInstance {
		const cell = stubInterface<IPositronNotebookCell>({
			index: 0,
			// A markdown cell: the cast satisfies isCodeCell's `this is` type guard.
			isCodeCell: (() => false) as IPositronNotebookCell['isCodeCell'],
			getContent: () => content,
		});
		return stubInterface<IPositronNotebookInstance>({
			uri: URI.file(path),
			cells: constObservable([cell]),
		});
	}

	/** One cell output carrying the given items (its `parsed` shape is unused here). */
	function cellOutput(items: IOutputItemDto[]): NotebookCellOutputs {
		return { outputId: 'out', outputs: items, parsed: { type: 'text', content: '' } };
	}

	/** A code cell at `index` with the given content and outputs. */
	function codeCell(index: number, content: string, outputs: NotebookCellOutputs[]): IPositronNotebookCell {
		return stubInterface<IPositronNotebookCell>({
			index,
			isCodeCell: (() => true) as IPositronNotebookCell['isCodeCell'],
			getContent: () => content,
			executionStatus: constObservable('idle' as const),
			outputs: constObservable(outputs),
		});
	}

	/** Tools wired with no notebook open (the notebook service lists none). */
	function withoutNotebook() {
		const editorService = stubInterface<IEditorService>({});
		const fileService = stubInterface<IFileService>({});
		const notebookService = stubInterface<IPositronNotebookService>({ listInstances: () => [] });
		return new PositronMcpNotebookTools(editorService, fileService, notebookService, resolvePath);
	}

	describe('guards when no notebook is open', () => {
		it('read/edit/runCells all report that no notebook is open', async () => {
			const tools = withoutNotebook();
			const noConsent = async () => { throw new Error('consent should not be requested'); };
			const message = 'No notebook is open in the editor. Open a notebook, then try again.';
			expect(textOf(await tools.read({}))).toBe(message);
			expect(textOf(await tools.edit({ editMode: 'delete', cellIndex: 0 }, noConsent))).toBe(message);
			expect(textOf(await tools.runCells({ cellIndices: [0] }, noConsent))).toBe(message);
		});
	});

	describe('resolves an open notebook regardless of focus', () => {
		it('reads a notebook that is open even when it is not the focused editor', async () => {
			// A single open notebook: no editor pane needs to be focused on it.
			const notebookService = stubInterface<IPositronNotebookService>({
				listInstances: () => [notebookInstance('/workspace/analysis.ipynb', '# Analysis')],
			});
			const tools = new PositronMcpNotebookTools(
				stubInterface<IEditorService>({}), stubInterface<IFileService>({}), notebookService, resolvePath);

			expect(textOf(await tools.read({}))).toContain('Notebook: file:///workspace/analysis.ipynb');
		});

		it('picks the most-recently-active notebook when several are open', async () => {
			const a = notebookInstance('/workspace/a.ipynb', '# A');
			const b = notebookInstance('/workspace/b.ipynb', '# B');
			// Registered in a-then-b order, but b is most recently active.
			const notebookService = stubInterface<IPositronNotebookService>({ listInstances: () => [a, b] });
			const editorId = (uri: URI): IEditorIdentifier => ({ groupId: 1, editor: stubInterface<EditorInput>({ resource: uri }) });
			const editorService = stubInterface<IEditorService>({
				getEditors: (order: EditorsOrder) =>
					order === EditorsOrder.MOST_RECENTLY_ACTIVE
						? [editorId(b.uri), editorId(a.uri)]
						: [editorId(a.uri), editorId(b.uri)],
			});
			const tools = new PositronMcpNotebookTools(
				editorService, stubInterface<IFileService>({}), notebookService, resolvePath);

			expect(textOf(await tools.read({}))).toContain('# B');
		});
	});

	describe('returns plot outputs as image content', () => {
		/** Tools wired to a single open notebook containing `cells`, runnable. */
		function toolsForNotebook(cells: IPositronNotebookCell[]) {
			const instance = stubInterface<IPositronNotebookInstance>({
				uri: URI.file('/workspace/plot.ipynb'),
				cells: constObservable(cells),
				kernel: constObservable(undefined),
				runCells: vi.fn(async () => { }),
				handleAssistantCellModification: vi.fn(async () => { }),
			});
			const notebookService = stubInterface<IPositronNotebookService>({ listInstances: () => [instance] });
			return new PositronMcpNotebookTools(
				stubInterface<IEditorService>({}), stubInterface<IFileService>({}), notebookService, resolvePath);
		}

		it('notebook-read includeOutputs returns a cell\'s image output alongside its text', async () => {
			const png = VSBuffer.fromString('PNGDATA');
			const tools = toolsForNotebook([codeCell(0, 'plot()', [cellOutput([
				{ mime: 'text/plain', data: VSBuffer.fromString('<Figure>') },
				{ mime: 'image/png', data: png },
			])])]);

			const result = await tools.read({ includeOutputs: true });

			expect(textOf(result)).toContain('<Figure>');
			expect(result.content).toEqual([
				{ type: 'text', text: expect.stringContaining('[1 image output returned as image content]') },
				{ type: 'image', mimeType: 'image/png', data: encodeBase64(png) },
			]);
		});

		it('notebook-run-cells returns the plot as an image block', async () => {
			const png = VSBuffer.fromString('PNGDATA');
			const tools = toolsForNotebook([codeCell(0, 'plot()', [cellOutput([{ mime: 'image/png', data: png }])])]);

			const result = await tools.runCells({ cellIndices: [0] }, async () => { });

			expect(result.content).toEqual([
				{ type: 'text', text: expect.stringContaining('[1 image output returned as image content]') },
				{ type: 'image', mimeType: 'image/png', data: encodeBase64(png) },
			]);
		});

		it('caps returned images and notes how many were omitted', async () => {
			const items: IOutputItemDto[] = Array.from({ length: 7 }, (_, i) => ({ mime: 'image/png', data: VSBuffer.fromString(`PNG${i}`) }));
			const tools = toolsForNotebook([codeCell(0, 'plots()', [cellOutput(items)])]);

			const result = await tools.read({ includeOutputs: true });

			expect(result.content.filter(c => c.type === 'image')).toHaveLength(5);
			expect(textOf(result)).toContain('7 image outputs: 5 returned as image content, 2 omitted (5-image limit)');
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
			const notebookService = stubInterface<IPositronNotebookService>({});
			const tools = new PositronMcpNotebookTools(editorService, fileService, notebookService, resolvePath);
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

			expect(textOf(result)).toContain('Created empty python notebook');
			// The written content is a valid empty Jupyter notebook with the kernelspec.
			const written = JSON.parse((writeFile.mock.calls[0][1] as VSBuffer).toString());
			expect(written).toMatchObject({ cells: [], nbformat: 4, metadata: { kernelspec: { name: 'python3' } } });
			// It is opened with the Positron notebook editor override.
			expect(getOpenedWith()).toMatchObject({ options: { override: 'workbench.editor.positronNotebook' } });
		});
	});
});
