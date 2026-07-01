/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, encodeBase64 } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMcpCallToolResult, McpContent } from '../../../../platform/positronMcp/common/positronMcpTools.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CellEditType, CellKind } from '../../notebook/common/notebookCommon.js';
import { cellToCellDtoForRestore } from '../../positronNotebook/browser/cellClipboardUtils.js';
import { IPositronNotebookInstance, NotebookOperationType } from '../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell, IPositronNotebookCodeCell } from '../../positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';
import { isImageMimeType, isTextBasedMimeType } from '../../positronNotebook/browser/notebookMimeUtils.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../positronNotebook/common/positronNotebookCommon.js';
import { textResult, truncateOutput } from './positronMcpFormat.js';

/**
 * Asks the user to consent to running `code`; throws if declined. The notebook
 * tools take this as a callback so consent state stays owned by the tool service.
 */
export type ConsentFn = (language: string, code: string) => Promise<void>;

/** Resolve a path (absolute, or relative to the first workspace folder) to a URI. */
export type ResolvePathFn = (inputPath: string) => URI;

/** Jupyter kernelspecs for notebooks created via the notebook-create tool. */
const KERNELSPECS: Record<string, { display_name: string; language: string; name: string }> = {
	python: { display_name: 'Python 3', language: 'python', name: 'python3' },
	r: { display_name: 'R', language: 'R', name: 'ir' },
};

/**
 * Cap on the number of image outputs returned in a single tool result, so a run
 * that plots in many cells can't blow up the response. Text notes any omitted.
 */
const MAX_NOTEBOOK_IMAGES = 5;

/**
 * The notebook-* MCP tools. Each acts on the notebook the user is working in
 * through the same in-process paths the `mainThreadNotebookFeatures` bridge uses
 * (the extension routed through that bridge), so behavior matches the extension:
 * cell edits are tagged as assistant operations, deletions leave a restore
 * sentinel, and the modified cell is revealed via follow mode. Methods return a
 * full MCP tool result -- text, plus image content blocks for any plot outputs
 * (capped at {@link MAX_NOTEBOOK_IMAGES}) -- which the caller passes straight to
 * the client.
 */
export class PositronMcpNotebookTools {
	constructor(
		private readonly _editorService: IEditorService,
		private readonly _fileService: IFileService,
		private readonly _notebookService: IPositronNotebookService,
		private readonly _resolvePath: ResolvePathFn,
	) { }

	/**
	 * The Positron notebook the tools act on, or undefined if none is open.
	 *
	 * Resolves against every *open* notebook (not just the focused editor pane)
	 * so the tools still work when a notebook is open while focus is elsewhere --
	 * e.g. the terminal or another editor. When several notebooks are open, picks
	 * the one the user touched most recently; most-recently-active order puts the
	 * focused notebook first, so this also matches the focused notebook when one
	 * is focused.
	 *
	 * Public so the get-active-document tool can report an open notebook: a
	 * notebook is not a text editor, so it never shows up as the active text
	 * editor, and that tool would otherwise report nothing open.
	 */
	resolveNotebook(): IPositronNotebookInstance | undefined {
		const instances = this._notebookService.listInstances();
		if (instances.length <= 1) {
			return instances[0];
		}
		for (const { editor } of this._editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			const match = editor.resource && instances.find(instance => isEqual(instance.uri, editor.resource));
			if (match) {
				return match;
			}
		}
		return instances[0];
	}

	/** The active notebook's kernel language, if a kernel is attached. */
	private _language(instance: IPositronNotebookInstance): string | undefined {
		return instance.kernel.get()?.runtime.languageId;
	}

	async read(args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const instance = this.resolveNotebook();
		if (!instance) {
			return textResult('No notebook is open in the editor. Open a notebook, then try again.');
		}
		const cellIndices = Array.isArray(args.cellIndices)
			? args.cellIndices.filter((i): i is number => typeof i === 'number')
			: undefined;
		const includeOutputs = args.includeOutputs === true;

		const allCells = instance.cells.get();
		if (allCells.length === 0) {
			return textResult('The active notebook is empty (0 cells).');
		}
		const cells = cellIndices ? allCells.filter(c => cellIndices.includes(c.index)) : allCells;
		if (cells.length === 0) {
			return textResult(`No cells found at the requested indices. The notebook has ${allCells.length} cells (indices 0-${allCells.length - 1}).`);
		}

		let output = `Notebook: ${instance.uri.toString()}\nTotal cells: ${allCells.length}`;
		if (cellIndices) {
			output += ` (showing ${cells.length})`;
		}
		output += '\n\n';

		const images: McpContent[] = [];
		for (const cell of cells) {
			const isCode = cell.isCodeCell();
			const status = isCode ? ` [${cell.executionStatus.get()}]` : '';
			output += `Cell ${cell.index} [${isCode ? 'CODE' : 'MARKDOWN'}]${status}\n${cell.getContent()}\n\n`;
			if (includeOutputs && cell.isCodeCell()) {
				for (const item of this._textOutputItems(cell)) {
					output += `Output:\n${item}\n\n`;
				}
				const { blocks, total } = this._cellImageBlocks(cell, MAX_NOTEBOOK_IMAGES - images.length);
				if (total > 0) {
					images.push(...blocks);
					output += `Output: ${this._imageNote(total, blocks.length)}\n\n`;
				}
			}
		}
		return { content: [{ type: 'text', text: truncateOutput(output.trimEnd()) }, ...images] };
	}

	async edit(args: Record<string, unknown>, consent: ConsentFn): Promise<IMcpCallToolResult> {
		const instance = this.resolveNotebook();
		if (!instance) {
			return textResult('No notebook is open in the editor. Open a notebook, then try again.');
		}
		const editMode = typeof args.editMode === 'string' ? args.editMode : '';
		const cellIndex = typeof args.cellIndex === 'number' ? args.cellIndex : undefined;
		const content = typeof args.content === 'string' ? args.content : undefined;
		const cellType = typeof args.cellType === 'string' ? args.cellType : undefined;
		const run = args.run === true;

		switch (editMode) {
			case 'insert': {
				if (!cellType) {
					throw new Error('cellType is required for insert mode');
				}
				if (content === undefined) {
					throw new Error('content is required for insert mode');
				}
				const runCell = run && cellType === 'code';
				if (runCell) {
					await consent(this._language(instance) ?? 'code', content);
				}

				const insertIndex = cellIndex ?? instance.cells.get().length;
				const kind = cellType === 'code' ? CellKind.Code : CellKind.Markup;

				// Tag as an assistant op so the notebook doesn't auto-select/scroll;
				// follow mode controls reveal based on the user's preference.
				instance.setCurrentOperation(NotebookOperationType.AssistantAdd);
				instance.addCell(kind, insertIndex, false, content);
				await instance.handleAssistantCellModification(insertIndex, 'add');

				if (runCell) {
					const inserted = instance.cells.get()[insertIndex];
					try {
						await instance.runCells([inserted]);
						const { text, images } = this._collectCellOutput(instance, [insertIndex]);
						return { content: [{ type: 'text', text: `Inserted and ran code cell at index ${insertIndex}.\n\nOutput:\n${text}` }, ...images] };
					} catch (error) {
						return textResult(`Inserted code cell at index ${insertIndex}, but execution failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
				return textResult(`Inserted ${cellType} cell at index ${insertIndex}.`);
			}

			case 'update': {
				if (cellIndex === undefined) {
					throw new Error('cellIndex is required for update mode');
				}
				if (content === undefined) {
					throw new Error('content is required for update mode');
				}
				await this._updateCellContent(instance, cellIndex, content);
				return textResult(`Updated cell ${cellIndex}.`);
			}

			case 'delete': {
				if (cellIndex === undefined) {
					throw new Error('cellIndex is required for delete mode');
				}
				const cell = instance.cells.get()[cellIndex];
				if (!cell) {
					throw new Error(`Cell not found at index: ${cellIndex}`);
				}
				// Capture cell data before deletion so the restore sentinel can undo it.
				const cellData = cellToCellDtoForRestore(cell);
				instance.deleteCell(cell);
				instance.addDeletionSentinel(cellIndex, cellData);
				return textResult(`Deleted cell ${cellIndex}.`);
			}

			default:
				throw new Error(`Unknown editMode: ${editMode}`);
		}
	}

	async runCells(args: Record<string, unknown>, consent: ConsentFn): Promise<IMcpCallToolResult> {
		const instance = this.resolveNotebook();
		if (!instance) {
			return textResult('No notebook is open in the editor. Open a notebook, then try again.');
		}
		const cellIndices = Array.isArray(args.cellIndices)
			? args.cellIndices.filter((i): i is number => typeof i === 'number')
			: [];
		if (cellIndices.length === 0) {
			throw new Error('cellIndices must be a non-empty array');
		}

		const cells = instance.cells.get();
		const code = cellIndices.map(i => cells[i]?.getContent() ?? '').join('\n\n');
		await consent(this._language(instance) ?? 'code', code);

		const cellsToRun = cellIndices
			.filter(i => i >= 0 && i < cells.length)
			.map(i => cells[i]);
		if (cellsToRun.length === 0) {
			throw new Error(`No cells found with indices: ${cellIndices.join(', ')}`);
		}

		await instance.runCells(cellsToRun);
		await instance.handleAssistantCellModification(cellsToRun[cellsToRun.length - 1].index);

		const { text, images } = this._collectCellOutput(instance, cellIndices);
		return { content: [{ type: 'text', text: text || '(no output)' }, ...images] };
	}

	async create(args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const notebookPath = typeof args.path === 'string' ? args.path : '';
		const language = typeof args.language === 'string' ? args.language : '';
		if (!notebookPath.trim()) {
			throw new Error('path is required');
		}
		if (!notebookPath.endsWith('.ipynb')) {
			throw new Error(`File must have a .ipynb extension: ${notebookPath}`);
		}
		const kernelspec = KERNELSPECS[language];
		if (!kernelspec) {
			throw new Error(`Unsupported language: ${language}`);
		}

		const uri = this._resolvePath(notebookPath);
		if (await this._fileService.exists(uri)) {
			throw new Error(`File already exists: ${notebookPath}`);
		}

		const notebook = {
			cells: [],
			metadata: { kernelspec, language_info: { name: kernelspec.language } },
			nbformat: 4,
			nbformat_minor: 5,
		};
		await this._fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(notebook, null, 2) + '\n'));

		// Open in the Positron notebook editor. openEditor resolves once the
		// editor is ready, so there's no need to wait for an active-editor event.
		try {
			await this._editorService.openEditor({ resource: uri, options: { override: POSITRON_NOTEBOOK_EDITOR_ID } });
		} catch {
			return textResult(`Created notebook ${notebookPath}, but failed to open it in the editor. Open it manually, then use notebook-edit to add cells.`);
		}
		return textResult(`Created empty ${language} notebook: ${notebookPath}. It is open and active; use notebook-edit with editMode "insert" to add cells.`);
	}

	/**
	 * Replace a cell's content while preserving its language, mime, outputs, and
	 * metadata. Mirrors the bridge's `$updateCellContent`: there is no
	 * single-method update on the instance, so this goes through the text model.
	 */
	private async _updateCellContent(instance: IPositronNotebookInstance, cellIndex: number, content: string): Promise<void> {
		const cell = instance.cells.get()[cellIndex];
		if (!cell) {
			throw new Error(`Cell not found at index: ${cellIndex}`);
		}
		const textModel = instance.textModel;
		if (!textModel) {
			throw new Error('No text model found for the active notebook.');
		}
		const cellModel = cell.model;
		const computeUndoRedo = !instance.isReadOnly || textModel.viewType === 'interactive';

		instance.setCurrentOperation(NotebookOperationType.AssistantEdit);
		textModel.applyEdits([
			{
				editType: CellEditType.Replace,
				index: cellIndex,
				count: 1,
				cells: [
					{
						source: content,
						language: cellModel.language,
						mime: cellModel.mime,
						cellKind: cellModel.cellKind,
						outputs: cellModel.outputs.map(output => ({ outputId: output.outputId, outputs: output.outputs })),
						metadata: cellModel.metadata,
						internalMetadata: cellModel.internalMetadata,
					},
				],
			},
		], true, undefined, () => undefined, undefined, computeUndoRedo);

		await instance.handleAssistantCellModification(cellIndex, 'modify');
	}

	/** Text outputs of one code cell, decoded to strings (images are skipped). */
	private _textOutputItems(cell: IPositronNotebookCodeCell): string[] {
		const items: string[] = [];
		for (const output of cell.outputs.get()) {
			for (const item of output.outputs) {
				if (isTextBasedMimeType(item.mime)) {
					items.push(item.data.toString());
				}
			}
		}
		return items;
	}

	/**
	 * Collect the outputs of the given cells into an MCP result body: a text block
	 * labeling each cell and inlining its text outputs, plus image content blocks
	 * for any plot outputs. Mirrors the extension's collectCellOutputText, but
	 * returns images as real content instead of dropping them to a text placeholder.
	 */
	private _collectCellOutput(instance: IPositronNotebookInstance, cellIndices: number[]): { text: string; images: McpContent[] } {
		const cells = instance.cells.get();
		const images: McpContent[] = [];
		let text = '';
		for (const index of cellIndices) {
			const cell: IPositronNotebookCell | undefined = cells[index];
			if (!cell?.isCodeCell()) {
				text += `Cell ${index}: (no output)\n`;
				continue;
			}
			const outputs = cell.outputs.get();
			if (outputs.length === 0) {
				text += `Cell ${index}: (no output)\n`;
				continue;
			}
			text += `Cell ${index}:\n`;
			for (const item of this._textOutputItems(cell)) {
				text += item + '\n';
			}
			const { blocks, total } = this._cellImageBlocks(cell, MAX_NOTEBOOK_IMAGES - images.length);
			if (total > 0) {
				images.push(...blocks);
				text += `${this._imageNote(total, blocks.length)}\n`;
			}
		}
		return { text: truncateOutput(text), images };
	}

	/**
	 * Image outputs of one code cell as MCP image content blocks (base64-encoded),
	 * taking at most `limit`. Also reports `total`, the count of image outputs in
	 * the cell regardless of the limit, so the caller can note any it dropped.
	 */
	private _cellImageBlocks(cell: IPositronNotebookCodeCell, limit: number): { blocks: McpContent[]; total: number } {
		const blocks: McpContent[] = [];
		let total = 0;
		for (const output of cell.outputs.get()) {
			for (const item of output.outputs) {
				if (!isImageMimeType(item.mime)) {
					continue;
				}
				total++;
				if (blocks.length < limit) {
					blocks.push({ type: 'image', data: encodeBase64(item.data), mimeType: item.mime });
				}
			}
		}
		return { blocks, total };
	}

	/** A one-line note describing how many image outputs were returned vs. omitted. */
	private _imageNote(total: number, returned: number): string {
		const plural = total === 1 ? '' : 's';
		const omitted = total - returned;
		return omitted > 0
			? `[${total} image output${plural}: ${returned} returned as image content, ${omitted} omitted (${MAX_NOTEBOOK_IMAGES}-image limit)]`
			: `[${total} image output${plural} returned as image content]`;
	}
}
