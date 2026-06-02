/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { observableValue } from '../../../../../../base/common/observable.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { CellTagsBar } from '../../../browser/notebookCells/CellTagsBar.js';
import { AddTagResult, IPositronNotebookCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';

/**
 * A minimal cell exposing just the tag surface the bar touches. The mutation
 * verbs (addTag / removeTag / renameTag) mirror the real cell model's
 * trim / dedup / membership behavior and write through to the observable, so the
 * rendered pills reflect the new state and interaction tests (e.g. a blur-commit
 * racing a same-click removal) read the latest tag state just like production.
 */
function createTagCell(initial: string[] = []) {
	// The real cell model de-duplicates tags on read, so the bar never sees
	// duplicate values. Mirror that here so this stub is a faithful stand-in for
	// a file loaded with duplicate tags.
	const tags = observableValue<string[]>('tags', [...new Set(initial)]);
	const addTag = vi.fn((tag: string): AddTagResult => {
		const value = tag.trim();
		if (!value) {
			return 'empty';
		}
		const latest = tags.get();
		if (latest.includes(value)) {
			return 'duplicate';
		}
		tags.set([...latest, value], undefined);
		return 'added';
	});
	const removeTag = vi.fn((tag: string): boolean => {
		const latest = tags.get();
		if (!latest.includes(tag)) {
			return true;
		}
		tags.set(latest.filter(t => t !== tag), undefined);
		return true;
	});
	const renameTag = vi.fn((oldTag: string, newTag: string): AddTagResult => {
		const value = newTag.trim();
		if (!value) {
			return 'empty';
		}
		const latest = tags.get();
		const index = latest.indexOf(oldTag);
		if (index < 0) {
			return 'failed';
		}
		if (latest.some((t, i) => i !== index && t === value)) {
			return 'duplicate';
		}
		const next = [...latest];
		next[index] = value;
		tags.set(next, undefined);
		return 'added';
	});
	const cell = stubInterface<IPositronNotebookCell>({ tags, addTag, removeTag, renameTag });
	return { cell, tags, addTag, removeTag, renameTag };
}

describe('CellTagsBar', () => {
	// The bar reads INotificationService from the React services context to toast
	// on a duplicate or failed write, so wire a stub we can assert against.
	const notificationInfo = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(INotificationService, { info: notificationInfo })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders a pill for each tag', () => {
		const { cell } = createTagCell(['data', 'wip']);
		rtl.render(<CellTagsBar cell={cell} />);

		// Assert the visible label text of each pill.
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

	it('focuses the input when the add affordance opens', async () => {
		const user = userEvent.setup();
		const { cell } = createTagCell(['data']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Add tag' }));

		// The TagInput focus effect must run on mount, or the typed value is lost.
		expect(screen.getByRole('textbox')).toHaveFocus();
	});

	it('focuses the input when an edit opens', async () => {
		const user = userEvent.setup();
		const { cell } = createTagCell(['old']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag old' }));

		// Switching a pill into edit mode remounts TagInput (distinct `edit-` key),
		// so its focus effect re-runs and focuses the edit input.
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

	it('notifies the user when a committed add is a duplicate', async () => {
		const user = userEvent.setup();
		const { cell, addTag } = createTagCell(['data']);
		addTag.mockReturnValue('duplicate');
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Add tag' }));
		await user.type(screen.getByRole('textbox'), 'data{Enter}');

		expect(notificationInfo).toHaveBeenCalledWith(expect.stringContaining('data'));
	});

	it('notifies the user when a committed add fails to write', async () => {
		// addTag returns 'failed' when the write can't be applied (detached cell,
		// no text model). The bar surfaces a generic write-failure toast rather
		// than dropping the tag silently.
		const user = userEvent.setup();
		const { cell, addTag } = createTagCell(['data']);
		addTag.mockReturnValue('failed');
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Add tag' }));
		await user.type(screen.getByRole('textbox'), 'oops{Enter}');

		expect(notificationInfo).toHaveBeenCalledWith(expect.stringContaining('Could not update'));
	});

	it('forwards an in-place edit to cell.renameTag', async () => {
		const user = userEvent.setup();
		const { cell, renameTag, tags } = createTagCell(['old']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag old' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'new{Enter}');

		expect(renameTag).toHaveBeenCalledWith('old', 'new');
		expect(tags.get()).toEqual(['new']);
	});

	it('notifies and does not rename when an edit duplicates another tag', async () => {
		const user = userEvent.setup();
		const { cell, tags } = createTagCell(['keep', 'rename-me']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag rename-me' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'keep{Enter}');

		expect(notificationInfo).toHaveBeenCalledWith(expect.stringContaining('keep'));
		// The rejected rename leaves the tag list unchanged.
		expect(tags.get()).toEqual(['keep', 'rename-me']);
	});

	it('notifies the user when an edit fails to write', async () => {
		// renameTag returns 'failed' when the write can't be applied; the bar must
		// surface the generic write-failure toast rather than dropping the rename.
		const user = userEvent.setup();
		const { cell, renameTag } = createTagCell(['old']);
		renameTag.mockReturnValue('failed');
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag old' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'new{Enter}');

		expect(notificationInfo).toHaveBeenCalledWith(expect.stringContaining('Could not update'));
	});

	it('removes a tag via its close affordance', async () => {
		const user = userEvent.setup();
		const { cell, removeTag, tags } = createTagCell(['keep', 'drop']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag drop' }));

		expect(removeTag).toHaveBeenCalledWith('drop');
		expect(tags.get()).toEqual(['keep']);
	});

	it('notifies the user when a removal fails to write', async () => {
		// removeTag returns false when the write can't be applied; the bar must
		// surface the generic write-failure toast rather than silently no-op.
		const user = userEvent.setup();
		const { cell, removeTag } = createTagCell(['keep', 'drop']);
		removeTag.mockReturnValue(false);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag drop' }));

		expect(notificationInfo).toHaveBeenCalledWith(expect.stringContaining('Could not update'));
	});

	it('keeps the surviving pills in order after removing a middle tag', async () => {
		// Pills are keyed by tag value, so a mid-list removal must re-render to
		// exactly the survivors, in order, without misassociating any pill by
		// position. Each pill's edit button carries its tag as text.
		const user = userEvent.setup();
		const { cell } = createTagCell(['a', 'b', 'c']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag b' }));

		const labels = screen.getAllByRole('button', { name: /^Edit tag / }).map(b => b.textContent);
		expect(labels).toEqual(['a', 'c']);
	});

	it('renders one pill per value for a file loaded with duplicate tags', () => {
		// The cell model collapses duplicates on read, so the bar shows a single
		// pill per value with no colliding keys.
		const { cell } = createTagCell(['dup', 'dup', 'x']);
		rtl.render(<CellTagsBar cell={cell} />);

		expect(screen.getAllByText('dup')).toHaveLength(1);
		expect(screen.getByText('x')).toBeInTheDocument();
	});

	it('removes only the de-duplicated tag, leaving the others', async () => {
		// removeTag operates on the de-duplicated list, so it can't drop a sibling
		// occurrence -- only 'x' survives.
		const user = userEvent.setup();
		const { cell, removeTag, tags } = createTagCell(['dup', 'dup', 'x']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag dup' }));

		expect(removeTag).toHaveBeenCalledWith('dup');
		expect(tags.get()).toEqual(['x']);
	});

	it('edits the de-duplicated tag without mis-targeting a sibling', async () => {
		// renameTag resolves against the de-duplicated list, so the rename lands
		// on the single 'dup' occurrence and leaves 'x' untouched.
		const user = userEvent.setup();
		const { cell, renameTag, tags } = createTagCell(['dup', 'dup', 'x']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag dup' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'renamed{Enter}');

		expect(renameTag).toHaveBeenCalledWith('dup', 'renamed');
		expect(tags.get()).toEqual(['renamed', 'x']);
	});

	it('removes a tag when an edit commits empty', async () => {
		const user = userEvent.setup();
		const { cell, removeTag, tags } = createTagCell(['gone']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag gone' }));
		await user.clear(screen.getByRole('textbox'));
		await user.keyboard('{Enter}');

		expect(removeTag).toHaveBeenCalledWith('gone');
		expect(tags.get()).toEqual([]);
	});

	it('keeps a blur-committed add when the same click removes another tag', async () => {
		const user = userEvent.setup();
		const { cell, tags } = createTagCell(['keep']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Add tag' }));
		await user.type(screen.getByRole('textbox'), 'fresh');
		await user.click(screen.getByRole('button', { name: 'Remove tag keep' }));

		expect(tags.get()).toEqual(['fresh']);
	});

	it('keeps a blur-committed edit when the same click removes another tag', async () => {
		const user = userEvent.setup();
		const { cell, tags } = createTagCell(['rename-me', 'drop']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag rename-me' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'renamed');
		await user.click(screen.getByRole('button', { name: 'Remove tag drop' }));

		expect(tags.get()).toEqual(['renamed']);
	});
});
