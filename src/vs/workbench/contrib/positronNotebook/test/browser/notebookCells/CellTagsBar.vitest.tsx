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
 * A minimal cell exposing just the tag surface the bar touches. `setTags` is a
 * spy that also writes through to the observable, so the rendered pills reflect
 * the new state after edit/remove (mirroring the real cell model). `addTag` is a
 * spy that returns `'added'` by default; its trim/dedup/append invariant is
 * covered by the cell-model tests, so the bar tests just drive its return value.
 */
function createTagCell(initial: string[] = []) {
	const tags = observableValue<string[]>('tags', initial);
	const setTags = vi.fn((next: string[]) => tags.set(next, undefined));
	const addTag = vi.fn((_tag: string): AddTagResult => 'added');
	const cell = stubInterface<IPositronNotebookCell>({ tags, setTags, addTag });
	return { cell, setTags, addTag };
}

describe('CellTagsBar', () => {
	// The bar reads INotificationService from the React services context to toast
	// on a duplicate tag, so wire a stub we can assert against.
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

	it('edits a tag in place', async () => {
		const user = userEvent.setup();
		const { cell, setTags } = createTagCell(['old']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag old' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'new{Enter}');

		expect(setTags).toHaveBeenCalledWith(['new']);
	});

	it('notifies and does not rename when an edit duplicates another tag', async () => {
		const user = userEvent.setup();
		const { cell, setTags } = createTagCell(['keep', 'rename-me']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag rename-me' }));
		const input = screen.getByRole('textbox');
		await user.clear(input);
		await user.type(input, 'keep{Enter}');

		expect(notificationInfo).toHaveBeenCalledWith(expect.stringContaining('keep'));
		expect(setTags).not.toHaveBeenCalled();
	});

	it('removes a tag via its close affordance', async () => {
		const user = userEvent.setup();
		const { cell, setTags } = createTagCell(['keep', 'drop']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag drop' }));

		expect(setTags).toHaveBeenCalledWith(['keep']);
	});

	it('keeps the surviving pills consistent after removing a middle tag', async () => {
		// Pills are keyed by tag value, so a mid-list removal must re-render to
		// exactly the survivors without misassociating any pill by position.
		const user = userEvent.setup();
		const { cell } = createTagCell(['a', 'b', 'c']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Remove tag b' }));

		expect(screen.queryByText('b')).not.toBeInTheDocument();
		expect(screen.getByText('a')).toBeInTheDocument();
		expect(screen.getByText('c')).toBeInTheDocument();
	});

	it('removes a tag when an edit commits empty', async () => {
		const user = userEvent.setup();
		const { cell, setTags } = createTagCell(['gone']);
		rtl.render(<CellTagsBar cell={cell} />);

		await user.click(screen.getByRole('button', { name: 'Edit tag gone' }));
		await user.clear(screen.getByRole('textbox'));
		await user.keyboard('{Enter}');

		expect(setTags).toHaveBeenCalledWith([]);
	});
});
