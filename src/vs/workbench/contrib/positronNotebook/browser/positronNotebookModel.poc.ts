/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PROOF OF CONCEPT: Simplified Positron Notebook Model
 * 
 * This demonstrates what an independent notebook model could look like
 * without VS Code notebook service dependencies.
 */

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';

// Simple interfaces - no VS Code notebook dependencies
export interface IPositronCell {
	readonly id: string;
	readonly type: 'code' | 'markdown';
	content: string;
	outputs: IPositronCellOutput[];
	metadata: Record<string, any>;
	executionCount?: number;
	isExecuting: boolean;
}

export interface IPositronCellOutput {
	readonly id: string;
	readonly type: string;
	readonly data: any;
	readonly metadata?: Record<string, any>;
}

export interface IPositronNotebookMetadata {
	kernelspec?: {
		name: string;
		language: string;
	};
	language_info?: {
		name: string;
		version?: string;
	};
	[key: string]: any;
}

export interface IPositronNotebookChange {
	type: 'cellAdded' | 'cellRemoved' | 'cellMoved' | 'cellContentChanged' | 'cellOutputsChanged' | 'metadataChanged';
	cellId?: string;
	index?: number;
}

/**
 * Simplified Positron Notebook Model
 * 
 * Key differences from VS Code's NotebookTextModel:
 * - No ICellEditOperation complexity
 * - Direct runtime integration
 * - Simple method-based API
 * - No extension compatibility layer
 * - Focused on .ipynb format only
 */
export class PositronNotebookModel extends Disposable {
	private _cells: PositronCell[] = [];
	private _metadata: IPositronNotebookMetadata = {};
	private _version: number = 0;
	private _isDirty: boolean = false;
	private _session: ILanguageRuntimeSession | undefined;

	// Events
	private readonly _onDidChangeContent = this._register(new Emitter<IPositronNotebookChange>());
	readonly onDidChangeContent: Event<IPositronNotebookChange> = this._onDidChangeContent.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<boolean>());
	readonly onDidChangeDirty: Event<boolean> = this._onDidChangeDirty.event;

	constructor(
		public readonly uri: URI,
		private readonly runtimeService: IRuntimeSessionService,
	) {
		super();
	}

	// --- Simple API Methods ---

	get cells(): readonly IPositronCell[] {
		return this._cells;
	}

	get metadata(): IPositronNotebookMetadata {
		return this._metadata;
	}

	get version(): number {
		return this._version;
	}

	get isDirty(): boolean {
		return this._isDirty;
	}

	/**
	 * Add a new cell to the notebook
	 */
	addCell(type: 'code' | 'markdown', content: string, index?: number): PositronCell {
		const cell = new PositronCell(type, content);
		
		if (index !== undefined && index >= 0 && index <= this._cells.length) {
			this._cells.splice(index, 0, cell);
		} else {
			this._cells.push(cell);
		}

		this._version++;
		this._setDirty(true);
		this._onDidChangeContent.fire({ 
			type: 'cellAdded', 
			cellId: cell.id,
			index: index ?? this._cells.length - 1
		});

		return cell;
	}

	/**
	 * Remove a cell from the notebook
	 */
	removeCell(cellId: string): boolean {
		const index = this._cells.findIndex(c => c.id === cellId);
		if (index === -1) {
			return false;
		}

		this._cells.splice(index, 1);
		this._version++;
		this._setDirty(true);
		this._onDidChangeContent.fire({ 
			type: 'cellRemoved', 
			cellId,
			index 
		});

		return true;
	}

	/**
	 * Move a cell to a new position
	 */
	moveCell(cellId: string, newIndex: number): boolean {
		const oldIndex = this._cells.findIndex(c => c.id === cellId);
		if (oldIndex === -1 || newIndex < 0 || newIndex >= this._cells.length) {
			return false;
		}

		const [cell] = this._cells.splice(oldIndex, 1);
		this._cells.splice(newIndex, 0, cell);

		this._version++;
		this._setDirty(true);
		this._onDidChangeContent.fire({ 
			type: 'cellMoved', 
			cellId,
			index: newIndex
		});

		return true;
	}

	/**
	 * Update cell content
	 */
	updateCellContent(cellId: string, content: string): boolean {
		const cell = this._cells.find(c => c.id === cellId);
		if (!cell) {
			return false;
		}

		cell.content = content;
		this._version++;
		this._setDirty(true);
		this._onDidChangeContent.fire({ 
			type: 'cellContentChanged', 
			cellId 
		});

		return true;
	}

	/**
	 * Execute a code cell - Direct runtime integration
	 */
	async executeCell(cellId: string): Promise<void> {
		const cell = this._cells.find(c => c.id === cellId);
		if (!cell || cell.type !== 'code') {
			return;
		}

		// Mark cell as executing
		cell.isExecuting = true;
		
		try {
			// Get or create runtime session
			if (!this._session || this._session.state !== 'ready') {
				this._session = await this.runtimeService.startSession(
					this.metadata.kernelspec?.language || 'python',
					'Notebook execution',
					{ notebookUri: this.uri }
				);
			}

			// Clear previous outputs
			cell.outputs = [];

			// Execute code directly through runtime
			const execution = await this._session.executeCode(
				cell.content,
				'notebook.cell'
			);

			// Handle outputs
			execution.onDidProduceOutput((output) => {
				cell.outputs.push({
					id: generateUuid(),
					type: output.type,
					data: output.data,
					metadata: output.metadata
				});
				
				this._onDidChangeContent.fire({ 
					type: 'cellOutputsChanged', 
					cellId 
				});
			});

			// Wait for completion
			await execution.complete;
			
			// Update execution count
			cell.executionCount = (cell.executionCount || 0) + 1;

		} finally {
			cell.isExecuting = false;
		}
	}

	/**
	 * Clear outputs for a cell
	 */
	clearCellOutputs(cellId: string): boolean {
		const cell = this._cells.find(c => c.id === cellId);
		if (!cell) {
			return false;
		}

		cell.outputs = [];
		this._setDirty(true);
		this._onDidChangeContent.fire({ 
			type: 'cellOutputsChanged', 
			cellId 
		});

		return true;
	}

	/**
	 * Clear all outputs in the notebook
	 */
	clearAllOutputs(): void {
		for (const cell of this._cells) {
			if (cell.outputs.length > 0) {
				cell.outputs = [];
				this._onDidChangeContent.fire({ 
					type: 'cellOutputsChanged', 
					cellId: cell.id 
				});
			}
		}
		this._setDirty(true);
	}

	// --- Serialization (ipynb only) ---

	/**
	 * Convert to .ipynb format
	 */
	toIPynb(): any {
		return {
			nbformat: 4,
			nbformat_minor: 2,
			metadata: this._metadata,
			cells: this._cells.map(cell => cell.toIPynbCell())
		};
	}

	/**
	 * Load from .ipynb format
	 */
	static fromIPynb(uri: URI, data: any, runtimeService: IRuntimeSessionService): PositronNotebookModel {
		const model = new PositronNotebookModel(uri, runtimeService);
		
		model._metadata = data.metadata || {};
		model._cells = (data.cells || []).map((cellData: any) => 
			PositronCell.fromIPynbCell(cellData)
		);
		
		return model;
	}

	// --- Private helpers ---

	private _setDirty(dirty: boolean): void {
		if (this._isDirty !== dirty) {
			this._isDirty = dirty;
			this._onDidChangeDirty.fire(dirty);
		}
	}

	/**
	 * Mark the notebook as saved
	 */
	markSaved(): void {
		this._setDirty(false);
	}
}

/**
 * Simple cell implementation
 */
class PositronCell implements IPositronCell {
	readonly id: string = generateUuid();
	outputs: IPositronCellOutput[] = [];
	metadata: Record<string, any> = {};
	executionCount?: number;
	isExecuting: boolean = false;

	constructor(
		public readonly type: 'code' | 'markdown',
		public content: string
	) {}

	toIPynbCell(): any {
		const base = {
			cell_type: this.type,
			metadata: this.metadata,
			source: this.content.split('\n').map((line, i, arr) => 
				i === arr.length - 1 ? line : line + '\n'
			)
		};

		if (this.type === 'code') {
			return {
				...base,
				execution_count: this.executionCount || null,
				outputs: this.outputs.map(o => ({
					output_type: o.type,
					data: o.data,
					metadata: o.metadata || {}
				}))
			};
		}

		return base;
	}

	static fromIPynbCell(data: any): PositronCell {
		const content = Array.isArray(data.source) 
			? data.source.join('') 
			: data.source;
		
		const cell = new PositronCell(
			data.cell_type as 'code' | 'markdown',
			content
		);

		cell.metadata = data.metadata || {};

		if (data.cell_type === 'code') {
			cell.executionCount = data.execution_count;
			cell.outputs = (data.outputs || []).map((o: any) => ({
				id: generateUuid(),
				type: o.output_type,
				data: o.data,
				metadata: o.metadata
			}));
		}

		return cell;
	}
}

/**
 * Simple undo/redo implementation
 * 
 * Much simpler than VS Code's complex system since we don't need
 * to integrate with their infrastructure.
 */
export class PositronNotebookUndoRedoManager {
	private undoStack: INotebookOperation[] = [];
	private redoStack: INotebookOperation[] = [];

	constructor(private model: PositronNotebookModel) {}

	pushOperation(operation: INotebookOperation): void {
		this.undoStack.push(operation);
		this.redoStack = []; // Clear redo stack on new operation
	}

	undo(): boolean {
		const operation = this.undoStack.pop();
		if (!operation) {
			return false;
		}

		operation.undo(this.model);
		this.redoStack.push(operation);
		return true;
	}

	redo(): boolean {
		const operation = this.redoStack.pop();
		if (!operation) {
			return false;
		}

		operation.redo(this.model);
		this.undoStack.push(operation);
		return true;
	}
}

interface INotebookOperation {
	undo(model: PositronNotebookModel): void;
	redo(model: PositronNotebookModel): void;
}

// Example operation
class AddCellOperation implements INotebookOperation {
	private cellId: string | undefined;

	constructor(
		private type: 'code' | 'markdown',
		private content: string,
		private index?: number
	) {}

	redo(model: PositronNotebookModel): void {
		const cell = model.addCell(this.type, this.content, this.index);
		this.cellId = cell.id;
	}

	undo(model: PositronNotebookModel): void {
		if (this.cellId) {
			model.removeCell(this.cellId);
		}
	}
}