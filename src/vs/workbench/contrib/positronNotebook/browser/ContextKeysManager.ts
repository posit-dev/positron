/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ContextKeyValue, IContextKey, IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { CellContextKeys } from '../common/cellContextKeys.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';

// Interface for the cell context keys
export type IPositronNotebookCellContextKeys = {
	readonly [K in keyof typeof CellContextKeys]: IContextKey<ContextKeyValue>;
};

/**
 * Bind all cell context keys to a scoped context key service
 */
export function bindCellContextKeys(service: IScopedContextKeyService): IPositronNotebookCellContextKeys {
	return {
		isCode: CellContextKeys.isCode.bindTo(service),
		isMarkdown: CellContextKeys.isMarkdown.bindTo(service),
		isRaw: CellContextKeys.isRaw.bindTo(service),
		isRunning: CellContextKeys.isRunning.bindTo(service),
		isPending: CellContextKeys.isPending.bindTo(service),
		isFirst: CellContextKeys.isFirst.bindTo(service),
		isLast: CellContextKeys.isLast.bindTo(service),
		isOnly: CellContextKeys.isOnly.bindTo(service),
		markdownEditorOpen: CellContextKeys.markdownEditorOpen.bindTo(service),
		isSelected: CellContextKeys.isSelected.bindTo(service),
		isActive: CellContextKeys.isActive.bindTo(service),
		canMoveUp: CellContextKeys.canMoveUp.bindTo(service),
		canMoveDown: CellContextKeys.canMoveDown.bindTo(service),
		hasOutputs: CellContextKeys.hasOutputs.bindTo(service),
		imageOutputCount: CellContextKeys.imageOutputCount.bindTo(service),
		jsonOutputCount: CellContextKeys.jsonOutputCount.bindTo(service),
		outputIsCollapsed: CellContextKeys.outputIsCollapsed.bindTo(service),
		outputOverflows: CellContextKeys.outputOverflows.bindTo(service),
		outputScrolling: CellContextKeys.outputScrolling.bindTo(service),
		outputFocused: CellContextKeys.outputFocused.bindTo(service),
		outputImageTargeted: CellContextKeys.outputImageTargeted.bindTo(service),
		outputJsonTargeted: CellContextKeys.outputJsonTargeted.bindTo(service),
	} satisfies IPositronNotebookCellContextKeys;
}

/**
 * Reset all cell context keys to their default values
 */
export function resetCellContextKeys(keys: IPositronNotebookCellContextKeys | undefined): void {
	if (!keys) {
		return;
	}

	Object.values(keys).forEach(contextKey => {
		contextKey.reset();
	});
}


/**
 * Class to handle context keys for positron notebook editor
 *
 * This class is responsible for setting up context keys for the positron notebook editor.
 * The context keys are made available for setting in appropriate places.
 */
export class PositronNotebookContextKeyManager extends Disposable {
	//#region Private Properties
	private readonly _containerDisposables = this._register(new DisposableStore());
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		private readonly _notebookInstance: IPositronNotebookInstance,
	) {
		super();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods
	setContainer(container: HTMLElement) {
		this._containerDisposables.clear();
		const disposables = this._containerDisposables;

		const { scopedContextKeyService, scopedInstantiationService } = this._notebookInstance;

		const positronEditorFocus = NotebookContextKeys.editorFocused.bindTo(scopedContextKeyService);

		disposables.add(toDisposable(() => positronEditorFocus.reset()));

		// Create the manager for VSCode notebook editor context keys
		// Extensions may depend on these familiar context keys
		disposables.add(scopedInstantiationService.createInstance(NotebookEditorContextKeys, this._notebookInstance));

		const focusTracker = disposables.add(DOM.trackFocus(container));
		disposables.add(focusTracker.onDidFocus(() => {
			positronEditorFocus.set(true);
		}));

		disposables.add(focusTracker.onDidBlur(() => {
			positronEditorFocus.set(false);
		}));
	}

	//#endregion Public Methods
}
