/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ServiceIdentifier, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, NotificationMessage } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';
import { AddTagAction } from '../../browser/contrib/cellTags/actions.js';
import { createLabelledTestNotebook } from './testPositronNotebookInstance.js';

/**
 * Verifies the "Add Tag" command opens the active cell's inline tag input (via
 * the cell's `beginAddTag` signal) and surfaces guidance when there's no cell to
 * target. The command body lives in `runNotebookAction`, so a test-only subclass
 * exposes it without standing up an active editor pane.
 */
describe('AddTagAction', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	class TestableAddTagAction extends AddTagAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}

	/**
	 * Builds an accessor exposing a notification spy so the test can assert what
	 * the command surfaced.
	 */
	function createAccessor() {
		const info = vi.fn<(message: NotificationMessage | NotificationMessage[]) => void>();
		const notifications = stubInterface<INotificationService>({ info });
		const accessor: ServicesAccessor = {
			get<T>(id: ServiceIdentifier<T>): T {
				if (id === INotificationService) {
					return notifications as unknown as T;
				}
				throw new Error(`Unexpected service request: ${String(id)}`);
			},
		};
		return { accessor, info };
	}

	it('opens the inline tag input on the active cell', async () => {
		const notebook = createLabelledTestNotebook(1, ctx);
		const cell = notebook.cells.get()[0];
		notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		const beginAddTag = vi.spyOn(cell, 'beginAddTag');
		const { accessor, info } = createAccessor();

		await new TestableAddTagAction().testRun(notebook, accessor);

		expect(beginAddTag).toHaveBeenCalled();
		// Opening the input needs no toast.
		expect(info).not.toHaveBeenCalled();
	});

	it('prompts the user to select a cell when none is selected', async () => {
		// With no active or selected cell (an empty notebook) the command can't
		// target anything, so it surfaces guidance instead of opening the input.
		const notebook = createLabelledTestNotebook(0, ctx);
		const { accessor, info } = createAccessor();

		await new TestableAddTagAction().testRun(notebook, accessor);

		expect(info).toHaveBeenCalledWith(expect.stringContaining('Select a cell'));
	});
});
