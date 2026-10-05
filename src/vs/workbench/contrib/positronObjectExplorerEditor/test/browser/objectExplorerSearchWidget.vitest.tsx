/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ObjectExplorerTreeInstance } from '../../../../browser/positronObjectExplorer/classes/objectExplorerTreeInstance.js';
import { IPositronObjectExplorerInstance } from '../../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerInstance.js';
import { ObjectExplorerSearchBox } from '../../browser/objectExplorerSearchWidget.js';

describe('ObjectExplorerSearchBox', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderSearchBox() {
		const onDidRequestSearchFocus = ctx.disposables.add(new Emitter<void>());
		const setSearchText = vi.fn();
		const requestFocus = vi.fn();
		const instance = stubInterface<IPositronObjectExplorerInstance>({
			searchText: '',
			setSearchText,
			onDidRequestSearchFocus: onDidRequestSearchFocus.event,
			treeInstance: stubInterface<ObjectExplorerTreeInstance>({ requestFocus }),
		});
		rtl.render(<ObjectExplorerSearchBox instance={instance} />);
		return { setSearchText, requestFocus, onDidRequestSearchFocus, input: screen.getByPlaceholderText('Search names and values') };
	}

	it('passes typed text to the instance', async () => {
		const user = userEvent.setup();
		const { setSearchText, input } = renderSearchBox();

		await user.type(input, 'ab');

		expect(setSearchText.mock.calls).toEqual([['a'], ['ab']]);
	});

	it('focuses when the instance asks it to', () => {
		const { input, onDidRequestSearchFocus } = renderSearchBox();

		act(() => onDidRequestSearchFocus.fire());

		expect(input).toHaveFocus();
	});

	it('clears the search and returns to the tree on Escape', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			const { setSearchText, requestFocus, input } = renderSearchBox();

			await user.type(input, 'x{Escape}');
			await vi.runAllTimersAsync();

			expect([setSearchText.mock.calls.at(-1), requestFocus.mock.calls.length]).toEqual([[''], 1]);
			expect(input).toHaveValue('');
		} finally {
			vi.useRealTimers();
		}
	});
});
