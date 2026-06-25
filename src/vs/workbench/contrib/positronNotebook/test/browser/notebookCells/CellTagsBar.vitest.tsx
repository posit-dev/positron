/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { derived, observableValue } from '../../../../../../base/common/observable.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { CellTagsBar } from '../../../browser/notebookCells/CellTagsBar.js';
import { IPositronNotebookCell, TagWriteResult } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';

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
	const cellTagsHidden = observableValue<boolean>('cellTagsHidden', false);
	// Mirrors the real cell's tagUIVisible derivation so the stub honors the
	// same contract the bar renders against.
	const tagUIVisible = derived(reader =>
		!cellTagsHidden.read(reader) && (tags.read(reader).length > 0 || isAddingTag.read(reader))
	);
	const addTag = vi.fn((tag: string): TagWriteResult => {
		tags.set([...tags.get(), tag], undefined);
		return 'ok';
	});
	const removeTag = vi.fn((tag: string): TagWriteResult => {
		tags.set(tags.get().filter(t => t !== tag), undefined);
		return 'ok';
	});
	const renameTag = vi.fn((oldTag: string, newTag: string): TagWriteResult => {
		tags.set(tags.get().map(t => (t === oldTag ? newTag : t)), undefined);
		return 'ok';
	});
	// The bar reads isAddingTag and drives it through begin/endAddTag (the same
	// signal the "Add Tag" command flips), so wire them to the observable.
	const beginAddTag = vi.fn(() => isAddingTag.set(true, undefined));
	const endAddTag = vi.fn(() => isAddingTag.set(false, undefined));
	const cell = stubInterface<IPositronNotebookCell>({ tags, isAddingTag, tagUIVisible, addTag, removeTag, renameTag, beginAddTag, endAddTag });
	return { cell, tags, isAddingTag, cellTagsHidden, addTag, removeTag, renameTag, beginAddTag, endAddTag };
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

	it('renders nothing when the notebook hides cell tags', () => {
		const { cell, cellTagsHidden } = createTagCell(['data']);
		rtl.render(<CellTagsBar cell={cell} />);
		expect(screen.getByTestId('cell-tags-bar')).toBeInTheDocument();

		act(() => cellTagsHidden.set(true, undefined));

		expect(screen.queryByTestId('cell-tags-bar')).not.toBeInTheDocument();
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

	it('is a single-tab-stop toolbar entered at the first tag, with the add control last', () => {
		const { cell } = createTagCell(['data', 'wip']);
		rtl.render(<CellTagsBar cell={cell} />);

		const buttons = screen.getAllByRole('button');
		expect(screen.getByRole('toolbar')).toBeInTheDocument();
		// The first tag is the only tab stop; the rest of the row (including
		// the trailing add control) is reached with the arrow keys so a long
		// tag list doesn't add a tab stop per tag.
		expect(buttons[0]).toHaveAccessibleName('Edit tag data');
		expect(buttons[0]).toHaveAttribute('tabindex', '0');
		expect(buttons[buttons.length - 1]).toHaveAccessibleName('Add tag');
		for (const button of buttons.slice(1)) {
			expect(button).toHaveAttribute('tabindex', '-1');
		}
	});

	it('moves focus through the controls with arrow keys', async () => {
		const user = userEvent.setup();
		const { cell } = createTagCell(['data']);
		rtl.render(<CellTagsBar cell={cell} />);

		// Tab enters the bar at its single tab stop, the first tag.
		await user.tab();
		expect(screen.getByRole('button', { name: 'Edit tag data' })).toHaveFocus();

		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('button', { name: 'Remove tag data' })).toHaveFocus();

		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('button', { name: 'Add tag' })).toHaveFocus();

		// The ends wrap around.
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('button', { name: 'Edit tag data' })).toHaveFocus();
		await user.keyboard('{ArrowLeft}');
		expect(screen.getByRole('button', { name: 'Add tag' })).toHaveFocus();
	});

	it('activates the focused control with Enter without leaking the key to the notebook', async () => {
		// Regression: keys handled inside the bar must not bubble out of it,
		// where the notebook's command-mode keybindings live -- Enter would
		// otherwise put the cell into edit mode on top of opening the tag editor.
		const user = userEvent.setup();
		const outerKeyDown = vi.fn();
		const { cell } = createTagCell(['data']);
		rtl.render(
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions -- stand-in for the notebook's key handling, not UI under test
			<div onKeyDown={outerKeyDown}>
				<CellTagsBar cell={cell} />
			</div>
		);

		await user.tab();
		await user.keyboard('{Enter}');

		expect(screen.getByRole('textbox')).toHaveFocus();
		expect(outerKeyDown).not.toHaveBeenCalled();
	});

	it('keeps the focus ring in the bar by landing on a neighbor after a keyboard removal', async () => {
		// A removed control unmounts; a keyboard user must not lose the focus ring
		// to <body>. Arrow to the second tag's remove control and activate it.
		const user = userEvent.setup();
		const { cell, removeTag } = createTagCell(['keep', 'drop']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.tab();
		await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
		expect(screen.getByRole('button', { name: 'Remove tag drop' })).toHaveFocus();
		await user.keyboard('{Enter}');

		expect(removeTag).toHaveBeenCalledWith('drop');
		// Focus slides to the neighbor that now occupies the row, not <body>.
		expect(screen.getByRole('button', { name: 'Edit tag keep' })).toHaveFocus();
	});

	it('returns focus to the pill after an Enter-committed edit', async () => {
		const user = userEvent.setup();
		const { cell } = createTagCell(['old']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag old' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'new{Enter}');

		// The input unmounts on commit; focus returns to the renamed pill rather
		// than dropping to <body>.
		expect(screen.getByRole('button', { name: 'Edit tag new' })).toHaveFocus();
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
		removeTag.mockReturnValue('failed');
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag drop' }));

		expect(notificationInfo).toHaveBeenCalled();
	});
});
