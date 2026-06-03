/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { autorun, observableFromEvent } from '../../../../../base/common/observable.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { CellSelectionStatus } from './IPositronNotebookCell.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCell.js';
import { CellContextKeys } from '../../common/cellContextKeys.js';
import { isParsedTextOutput } from '../getOutputContents.js';

/**
 * Manages context keys scoped to a single notebook cell.
 */
export class CellContextKeyManager extends Disposable {
	private readonly isCode: IContextKey<boolean>;
	private readonly isMarkdown: IContextKey<boolean>;
	private readonly isRaw: IContextKey<boolean>;
	private readonly isRunning: IContextKey<boolean>;
	private readonly isPending: IContextKey<boolean>;
	private readonly isFirst: IContextKey<boolean>;
	private readonly isLast: IContextKey<boolean>;
	private readonly isOnly: IContextKey<boolean>;
	private readonly markdownEditorOpen: IContextKey<boolean>;
	private readonly isSelected: IContextKey<boolean>;
	private readonly isActive: IContextKey<boolean>;
	private readonly canMoveUp: IContextKey<boolean>;
	private readonly canMoveDown: IContextKey<boolean>;
	private readonly hasOutputs: IContextKey<boolean>;
	private readonly imageOutputCount: IContextKey<number>;
	private readonly jsonOutputCount: IContextKey<number>;
	private readonly outputIsCollapsed: IContextKey<boolean>;
	private readonly outputScrolling: IContextKey<boolean>;
	private readonly outputOverflows: IContextKey<boolean>;

	// Set from the React layer in response to DOM events (focus, context menu targets).
	readonly outputFocused: IContextKey<boolean>;
	readonly outputImageTargeted: IContextKey<boolean>;
	readonly outputJsonTargeted: IContextKey<boolean>;

	constructor(
		cell: PositronNotebookCellGeneral,
		instance: PositronNotebookInstance,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();

		// Bind all keys to the scoped service
		this.isCode = CellContextKeys.isCode.bindTo(contextKeyService);
		this.isMarkdown = CellContextKeys.isMarkdown.bindTo(contextKeyService);
		this.isRaw = CellContextKeys.isRaw.bindTo(contextKeyService);
		this.isRunning = CellContextKeys.isRunning.bindTo(contextKeyService);
		this.isPending = CellContextKeys.isPending.bindTo(contextKeyService);
		this.isFirst = CellContextKeys.isFirst.bindTo(contextKeyService);
		this.isLast = CellContextKeys.isLast.bindTo(contextKeyService);
		this.isOnly = CellContextKeys.isOnly.bindTo(contextKeyService);
		this.markdownEditorOpen = CellContextKeys.markdownEditorOpen.bindTo(contextKeyService);
		this.isSelected = CellContextKeys.isSelected.bindTo(contextKeyService);
		this.isActive = CellContextKeys.isActive.bindTo(contextKeyService);
		this.canMoveUp = CellContextKeys.canMoveUp.bindTo(contextKeyService);
		this.canMoveDown = CellContextKeys.canMoveDown.bindTo(contextKeyService);
		this.hasOutputs = CellContextKeys.hasOutputs.bindTo(contextKeyService);
		this.imageOutputCount = CellContextKeys.imageOutputCount.bindTo(contextKeyService);
		this.jsonOutputCount = CellContextKeys.jsonOutputCount.bindTo(contextKeyService);
		this.outputIsCollapsed = CellContextKeys.outputIsCollapsed.bindTo(contextKeyService);
		this.outputScrolling = CellContextKeys.outputScrolling.bindTo(contextKeyService);
		this.outputOverflows = CellContextKeys.outputOverflows.bindTo(contextKeyService);
		this.outputFocused = CellContextKeys.outputFocused.bindTo(contextKeyService);
		this.outputImageTargeted = CellContextKeys.outputImageTargeted.bindTo(contextKeyService);
		this.outputJsonTargeted = CellContextKeys.outputJsonTargeted.bindTo(contextKeyService);

		// Subscribe to model state and keep keys in sync
		const layoutConfigObs = observableFromEvent(
			instance.notebookOptions.onDidChangeOptions,
			() => instance.notebookOptions.getLayoutConfiguration()
		);

		this._register(autorun(reader => {
			if (cell.index === -1) {
				this._reset();
				return;
			}

			const executionStatus = cell.executionStatus.read(reader);
			const selectionStatus = cell.selectionStatus.read(reader);
			const isActiveCell = cell.isActive.read(reader);
			const cells = instance.cells.read(reader);
			const outputs = cell.isCodeCell() ? cell.outputs.read(reader) : [];
			const outputIsCollapsed = cell.isCodeCell() ? cell.outputIsCollapsed.read(reader) : false;
			const outputScrolling = cell.isCodeCell() ? cell.outputScrolling.read(reader) : undefined;
			const { outputScrolling: globalOutputScrolling, outputLineLimit } = layoutConfigObs.read(reader);

			this.isCode.set(cell.isCodeCell());
			this.isMarkdown.set(cell.isMarkdownCell());
			this.isRaw.set(cell.isRawCell());
			this.isRunning.set(executionStatus === 'running');
			this.isPending.set(executionStatus === 'pending');
			this.isFirst.set(cell.index === 0);
			this.isLast.set(cells.indexOf(cell) === cells.length - 1);
			this.isOnly.set(cells.length === 1);
			this.markdownEditorOpen.set(cell.isMarkdownCell() ? cell.editorShown.read(reader) : false);
			this.isSelected.set(selectionStatus === CellSelectionStatus.Selected);
			this.isActive.set(isActiveCell);
			this.canMoveUp.set(cell.index > 0 && cells.length > 1);
			this.canMoveDown.set(cell.index < cells.length - 1 && cells.length > 1);
			this.hasOutputs.set(outputs.length > 0);
			this.imageOutputCount.set(outputs.filter(o => o.parsed.type === 'image').length);
			this.jsonOutputCount.set(outputs.filter(o => o.parsed.type === 'json').length);
			this.outputIsCollapsed.set(outputIsCollapsed);
			this.outputScrolling.set(outputScrolling ?? globalOutputScrolling);
			this.outputOverflows.set(outputs.some(o =>
				isParsedTextOutput(o.parsed) && o.parsed.content.trimEnd().split('\n').length > outputLineLimit
			));
		}));
	}

	private _reset(): void {
		this.isCode.reset();
		this.isMarkdown.reset();
		this.isRaw.reset();
		this.isRunning.reset();
		this.isPending.reset();
		this.isFirst.reset();
		this.isLast.reset();
		this.isOnly.reset();
		this.markdownEditorOpen.reset();
		this.isSelected.reset();
		this.isActive.reset();
		this.canMoveUp.reset();
		this.canMoveDown.reset();
		this.hasOutputs.reset();
		this.imageOutputCount.reset();
		this.jsonOutputCount.reset();
		this.outputIsCollapsed.reset();
		this.outputScrolling.reset();
		this.outputOverflows.reset();
		this.outputFocused.reset();
		this.outputImageTargeted.reset();
		this.outputJsonTargeted.reset();
	}
}
