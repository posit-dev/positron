/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IObservable, autorun } from '../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IModelDeltaDecoration } from '../../../../../editor/common/model.js';
import { Range } from '../../../../../editor/common/core/range.js';

/**
 * Decoration entry stored in the decorations map.
 */
interface ICellDecoration {
	/** Our stable string ID for this decoration */
	id: string;
	/** Current editor decoration ID, undefined when not applied */
	decorationId: string | undefined;
	/** The decoration specification (range and options) */
	options: IModelDeltaDecoration;
}

/**
 * Manages decorations for a notebook cell across editor mount/unmount cycles.
 */
export class CellDecorationManager extends Disposable {
	/** Map of string id -> decoration entry */
	private readonly _decorations = new Map<string, ICellDecoration>();

	/** Counter for generating cell decoration IDs */
	private _nextId = 0;

	/** Current attached editor, if any */
	private _editor: ICodeEditor | undefined;

	/** Disposables for editor-specific listeners */
	private readonly _editorDisposables = this._register(new DisposableStore());

	/**
	 * @param editor Observable that emits the current editor or undefined
	 */
	constructor(
		editor: IObservable<ICodeEditor | undefined>,
	) {
		super();

		// React to editor changes
		this._register(autorun(reader => {
			const currentEditor = editor.read(reader);
			if (currentEditor) {
				this._attachEditor(currentEditor);
			} else {
				this._detachEditor();
			}
		}));
	}

	/**
	 * Attach an editor to this decoration manager.
	 */
	private _attachEditor(editor: ICodeEditor): void {
		// Clean up previous editor listeners
		this._editorDisposables.clear();
		this._editor = editor;

		// Apply pending decorations if editor has a model
		if (editor.hasModel()) {
			this._applyDecorationsToEditor(editor);
		}

		// Listen for model changes - if model is replaced, decoration IDs become invalid
		this._editorDisposables.add(editor.onDidChangeModel(() => {
			this._clearDecorationIds();

			// If there's a new model, apply decorations to it
			if (editor.hasModel()) {
				this._applyDecorationsToEditor(editor);
			}
		}));
	}

	/**
	 * Detach the current editor.
	 * Decoration IDs are cleared but options are preserved for reapplication
	 * when a new editor is attached.
	 */
	private _detachEditor(): void {
		// Clean up editor listeners
		this._editorDisposables.clear();

		// Remove decorations from editor but keep options in map
		if (this._editor?.hasModel()) {
			this._editor.changeDecorations(accessor => {
				for (const entry of this._decorations.values()) {
					if (entry.decorationId) {
						accessor.removeDecoration(entry.decorationId);
						entry.decorationId = undefined;
					}
				}
			});
		}

		this._editor = undefined;
	}

	/**
	 * Replace old decorations with new ones (batch operation).
	 * This is the primary API for updating decorations efficiently.
	 *
	 * @param oldDecorations String IDs of decorations to remove
	 * @param newDecorations New decorations to add
	 * @returns String IDs of the new decorations
	 */
	deltaModelDecorations(
		oldDecorations: readonly string[],
		newDecorations: readonly IModelDeltaDecoration[]
	): string[] {
		for (const id of oldDecorations) {
			this._removeModelDecoration(id);
		}
		return newDecorations.map(d => this._addModelDecoration(d));
	}

	/**
	 * Add a single decoration.
	 * If no editor is attached, stores for later application.
	 *
	 * @param decoration The decoration to add
	 * @returns The string decoration ID
	 */
	private _addModelDecoration(decoration: IModelDeltaDecoration): string {
		const id = `${this._nextId++}`;
		const entry: ICellDecoration = { id, decorationId: undefined, options: decoration };
		this._decorations.set(id, entry);

		if (this._editor && this._editor.hasModel()) {
			this._editor.changeDecorations(accessor => {
				entry.decorationId = accessor.addDecoration(decoration.range, decoration.options);
			});
		}

		return id;
	}

	/**
	 * Remove a single decoration.
	 *
	 * @param id The string ID of the decoration to remove
	 */
	private _removeModelDecoration(id: string): void {
		const entry = this._decorations.get(id);
		if (!entry) {
			return;
		}

		const { decorationId } = entry;
		if (decorationId && this._editor && this._editor.hasModel()) {
			this._editor.changeDecorations(accessor => {
				accessor.removeDecoration(decorationId);
			});
		}

		this._decorations.delete(id);
	}

	/**
	 * Get the current range of a decoration.
	 * If an editor is attached, returns the live range from the editor.
	 * Otherwise, returns the stored range.
	 *
	 * @param id The string ID of the decoration
	 * @returns The range, or null if decoration not found
	 */
	getCellDecorationRange(id: string): Range | null {
		const entry = this._decorations.get(id);
		if (!entry) {
			return null;
		}

		const { decorationId } = entry;
		if (decorationId && this._editor && this._editor.hasModel()) {
			return this._editor.getModel().getDecorationRange(decorationId);
		}

		// Return stored range if no editor
		return Range.lift(entry.options.range);
	}

	/**
	 * Clear all decorations.
	 */
	private _clearDecorations(): void {
		if (this._editor && this._editor.hasModel()) {
			this._editor.changeDecorations(accessor => {
				for (const { decorationId } of this._decorations.values()) {
					if (decorationId) {
						accessor.removeDecoration(decorationId);
					}
				}
			});
		}
		this._decorations.clear();
	}

	override dispose(): void {
		this._clearDecorations();

		super.dispose();
	}

	/** Apply all tracked decorations to the given editor */
	private _applyDecorationsToEditor(editor: ICodeEditor): void {
		editor.changeDecorations(accessor => {
			for (const entry of this._decorations.values()) {
				entry.decorationId = accessor.addDecoration(entry.options.range, entry.options.options);
			}
		});
	}

	/** Clear all decoration IDs (options preserved for reapplication) */
	private _clearDecorationIds(): void {
		for (const entry of this._decorations.values()) {
			entry.decorationId = undefined;
		}
	}
}
