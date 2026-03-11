/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize2 } from '../../../../../../nls.js';
import { MenuId, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { getActiveCell } from '../../selectionMachine.js';
import { CellEditType } from '../../../../notebook/common/notebookCommon.js';
import { CellCommentsModal } from './CellCommentsModal.js';
import { getCellComments, ICellComment, setCellComments } from './cellCommentTypes.js';

const CELL_COMMENTS_COMMAND_ID = 'positronNotebook.cell.comments';

// Register the cell comment action in the cell action bar
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: CELL_COMMENTS_COMMAND_ID,
			title: localize2('positronNotebook.cell.comments', 'Cell Comments'),
			icon: ThemeIcon.fromId('comment-discussion'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarRight,
				order: 50,
				group: 'Cell',
			},
		});
	}

	override async runNotebookAction(
		notebook: IPositronNotebookInstance,
		accessor: ServicesAccessor,
	): Promise<void> {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (!cell) {
			return;
		}

		const textModel = notebook.textModel;
		if (!textModel) {
			return;
		}

		const cellIndex = cell.index;
		const cellModel = textModel.cells[cellIndex];
		if (!cellModel) {
			return;
		}

		const currentMetadata = cellModel.metadata ?? {};
		const existingComments = getCellComments(currentMetadata);

		const renderer = new PositronModalReactRenderer();

		const handleSave = (comments: ICellComment[]) => {
			const newMetadata = setCellComments({ ...currentMetadata }, comments);
			textModel.applyEdits([{
				editType: CellEditType.Metadata,
				index: cellIndex,
				metadata: newMetadata,
			}], true, undefined, () => undefined, undefined, true);
		};

		renderer.render(
			<CellCommentsModal
				comments={existingComments}
				defaultAuthor={''}
				renderer={renderer}
				onSave={handleSave}
			/>
		);
	}
});
