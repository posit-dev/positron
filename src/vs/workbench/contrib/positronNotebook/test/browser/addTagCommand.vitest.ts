/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ServiceIdentifier, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, NotificationMessage } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';
import { AddTagAction } from '../../browser/positronNotebook.contribution.js';
import { createLabelledTestNotebook } from './testPositronNotebookInstance.js';

/**
 * Verifies the "Add Tag" command surfaces feedback for the non-write outcomes
 * the cell model reports. The command body lives in `runNotebookAction`, so a
 * test-only subclass exposes it without standing up an active editor pane.
 */
describe('AddTagAction', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	class TestableAddTagAction extends AddTagAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}

	/**
	 * Builds an accessor whose quick input resolves to `typed`, returning the
	 * notification spy so the test can assert what the command surfaced.
	 */
	function createAccessor(typed: string) {
		const info = vi.fn<(message: NotificationMessage | NotificationMessage[]) => void>();
		const quickInput = stubInterface<IQuickInputService>({ input: async () => typed });
		const notifications = stubInterface<INotificationService>({ info });
		const accessor: ServicesAccessor = {
			get<T>(id: ServiceIdentifier<T>): T {
				if (id === IQuickInputService) {
					return quickInput as unknown as T;
				}
				if (id === INotificationService) {
					return notifications as unknown as T;
				}
				throw new Error(`Unexpected service request: ${String(id)}`);
			},
		};
		return { accessor, info };
	}

	it('notifies the user when the tag write fails', async () => {
		const notebook = createLabelledTestNotebook(1, ctx);
		const cell = notebook.cells.get()[0];
		notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		// 'failed' is the model's no-write outcome (detached cell / no text model);
		// the command must surface it rather than dropping the typed tag silently.
		vi.spyOn(cell, 'addTag').mockReturnValue('failed');
		const { accessor, info } = createAccessor('oops');

		await new TestableAddTagAction().testRun(notebook, accessor);

		// The shared helper shows a generic write-failure toast (no tag value).
		expect(info).toHaveBeenCalledWith(expect.stringContaining('Could not update'));
	});

	it('notifies the user when the typed tag is a duplicate', async () => {
		const notebook = createLabelledTestNotebook(1, ctx);
		const cell = notebook.cells.get()[0];
		notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		vi.spyOn(cell, 'addTag').mockReturnValue('duplicate');
		const { accessor, info } = createAccessor('data');

		await new TestableAddTagAction().testRun(notebook, accessor);

		expect(info).toHaveBeenCalledWith(expect.stringContaining('data'));
	});

	it('adds the tag silently when the write succeeds', async () => {
		const notebook = createLabelledTestNotebook(1, ctx);
		const cell = notebook.cells.get()[0];
		notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		const addTag = vi.spyOn(cell, 'addTag').mockReturnValue('added');
		const { accessor, info } = createAccessor('fresh');

		await new TestableAddTagAction().testRun(notebook, accessor);

		expect(addTag).toHaveBeenCalledWith('fresh');
		// A successful add needs no toast.
		expect(info).not.toHaveBeenCalled();
	});

	it('prompts the user to select a cell when none is selected', async () => {
		// With no active or selected cell (an empty notebook) the command can't
		// target anything, so it surfaces guidance instead of opening the quick
		// input.
		const notebook = createLabelledTestNotebook(0, ctx);
		const { accessor, info } = createAccessor('ignored');

		await new TestableAddTagAction().testRun(notebook, accessor);

		expect(info).toHaveBeenCalledWith(expect.stringContaining('Select a cell'));
	});
});
