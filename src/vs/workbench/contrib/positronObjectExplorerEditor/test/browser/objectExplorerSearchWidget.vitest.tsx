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
import { IPositronObjectExplorerInstance } from '../../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerInstance.js';
import { ObjectExplorerSearchBox } from '../../browser/objectExplorerSearchWidget.js';

describe('ObjectExplorerSearchBox', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderSearchBox() {
		const onDidRequestSearchFocus = ctx.disposables.add(new Emitter<void>());
		const onDidChangeSearch = ctx.disposables.add(new Emitter<void>());
		const setSearchText = vi.fn();
		const clearSearch = vi.fn();
		const instance = stubInterface<IPositronObjectExplorerInstance>({
			searchText: '',
			setSearchText,
			clearSearch,
			onDidRequestSearchFocus: onDidRequestSearchFocus.event,
			onDidChangeSearch: onDidChangeSearch.event,
		});
		rtl.render(<ObjectExplorerSearchBox instance={instance} />);
		return { setSearchText, clearSearch, onDidRequestSearchFocus, onDidChangeSearch, input: screen.getByPlaceholderText('Search names and values') };
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

	it('clears the search on Escape', async () => {
		const user = userEvent.setup();
		const { clearSearch, input } = renderSearchBox();

		await user.type(input, 'x{Escape}');

		expect(clearSearch).toHaveBeenCalledOnce();
	});

	it('empties when the search is cleared', async () => {
		const user = userEvent.setup();
		const { input, onDidChangeSearch } = renderSearchBox();

		await user.type(input, 'x');
		act(() => onDidChangeSearch.fire());

		expect(input).toHaveValue('');
	});
});
