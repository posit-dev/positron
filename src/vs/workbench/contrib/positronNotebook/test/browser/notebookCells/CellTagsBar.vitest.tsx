/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { observableValue } from '../../../../../../base/common/observable.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { CellTagsBar } from '../../../browser/notebookCells/CellTagsBar.js';
import { AddTagResult, IPositronNotebookCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';

/**
 * A minimal cell stub. The tag-set invariant (trim / dedup / duplicate
 * rejection) lives in the real model and is tested in
 * `positronNotebookCell.vitest.ts`, so these verbs are plain spies that write
 * through to the observable -- just enough for the bar to re-render. Tests assert
 * the bar calls the right verb with the right value; they do not re-check the
 * invariant against this double.
 */
function createTagCell(initial: string[] = []) {
	const tags = observableValue<string[]>('tags', [...initial]);
	const isAddingTag = observableValue<boolean>('isAddingTag', false);
	const addTag = vi.fn((tag: string): AddTagResult => {
		tags.set([...tags.get(), tag], undefined);
		return 'added';
	});
	const removeTag = vi.fn((tag: string): boolean => {
		tags.set(tags.get().filter(t => t !== tag), undefined);
		return true;
	});
	const renameTag = vi.fn((oldTag: string, newTag: string): AddTagResult => {
		tags.set(tags.get().map(t => (t === oldTag ? newTag : t)), undefined);
		return 'added';
	});
	// The bar reads isAddingTag and drives it through begin/endAddTag (the same
	// signal the "Add Tag" command flips), so wire them to the observable.
	const beginAddTag = vi.fn(() => isAddingTag.set(true, undefined));
	const endAddTag = vi.fn(() => isAddingTag.set(false, undefined));
	const cell = stubInterface<IPositronNotebookCell>({ tags, isAddingTag, addTag, removeTag, renameTag, beginAddTag, endAddTag });
	return { cell, tags, isAddingTag, addTag, removeTag, renameTag, beginAddTag, endAddTag };
}

describe('CellTagsBar', () => {
	// The bar reads INotificationService from the React services context to toast
	// on a rejected write, so wire a stub we can assert against.
	const notificationInfo = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(INotificationService, { info: notificationInfo })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders a pill for each tag', () => {
		const { cell } = createTagCell(['data', 'wip']);
		rtl.render(<CellTagsBar cell={cell} />);

		expect(screen.getByText('data')).toBeInTheDocument();
		expect(screen.getByText('wip')).toBeInTheDocument();
	});

	it('renders nothing (including the add affordance) when there are no tags', () => {
		const { cell } = createTagCell([]);
		const { container } = rtl.render(<CellTagsBar cell={cell} />);

		expect(container).toBeEmptyDOMElement();
	});

	it('applies the standalone modifier for the non-footer placement', () => {
		const { cell } = createTagCell(['x']);
		rtl.render(<CellTagsBar standalone cell={cell} />);

		expect(screen.getByTestId('cell-tags-bar')).toHaveClass('standalone');
	});

	it('opens a focused inline input on an untagged cell when a tag-add is requested', () => {
		// The "Add Tag" command flips the cell's isAddingTag signal; the bar must
		// open the inline input even though an untagged cell renders nothing at rest.
		const { cell, isAddingTag } = createTagCell([]);
		rtl.render(<CellTagsBar cell={cell} />);

		expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

		act(() => isAddingTag.set(true, undefined));

		expect(screen.getByRole('textbox')).toHaveFocus();
	});

	it('forwards an Enter-committed add to cell.addTag', async () => {
		const user = userEvent.setup();
		const { cell, addTag } = createTagCell(['data']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Add tag' }));
		await user.type(screen.getByRole('textbox'), 'fresh{Enter}');

		// The cell owns trim / dedup; the bar just forwards the typed value.
		expect(addTag).toHaveBeenCalledWith('fresh');
	});

	it('forwards a blur-committed add to cell.addTag', async () => {
		const user = userEvent.setup();
		const { cell, addTag } = createTagCell(['data']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Add tag' }));
		await user.type(screen.getByRole('textbox'), 'viablur');
		// Tab away to blur the input.
		await user.tab();

		expect(addTag).toHaveBeenCalledWith('viablur');
	});

	it('cancels an add on Escape without calling addTag', async () => {
		const user = userEvent.setup();
		const { cell, addTag } = createTagCell(['data']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Add tag' }));
		await user.type(screen.getByRole('textbox'), 'discard{Escape}');

		expect(addTag).not.toHaveBeenCalled();
		// The input is gone and the add affordance is back.
		expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument();
	});

	it('focuses the input and forwards an in-place edit to cell.renameTag', async () => {
		const user = userEvent.setup();
		const { cell, renameTag } = createTagCell(['old']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag old' }));
		const input = screen.getByRole('textbox');
		// Switching a pill to edit mode remounts TagInput (distinct `edit-` key),
		// so its focus effect re-runs and focuses the edit input.
		expect(input).toHaveFocus();
		await user.clear(input);
		await user.type(input, 'new{Enter}');

		expect(renameTag).toHaveBeenCalledWith('old', 'new');
	});

	it('removes a tag via its close affordance', async () => {
		const user = userEvent.setup();
		const { cell, removeTag } = createTagCell(['keep', 'drop']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag drop' }));

		expect(removeTag).toHaveBeenCalledWith('drop');
	});

	it('routes an edit cleared to empty through removeTag', async () => {
		const user = userEvent.setup();
		const { cell, removeTag } = createTagCell(['gone']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag gone' }));
		await user.clear(screen.getByRole('textbox'));
		await user.keyboard('{Enter}');

		// Clearing the field is the bar's "remove" affordance -- it routes to
		// removeTag rather than renaming to an empty value.
		expect(removeTag).toHaveBeenCalledWith('gone');
	});

	it('notifies the user when a write is rejected', async () => {
		// The result -> toast mapping is the model/helper's job; here we only prove
		// the bar surfaces a rejected write (the uniform-feedback behavior) instead
		// of silently no-opping.
		const user = userEvent.setup();
		const { cell, removeTag } = createTagCell(['keep', 'drop']);
		removeTag.mockReturnValue(false);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag drop' }));

		expect(notificationInfo).toHaveBeenCalled();
	});
});
