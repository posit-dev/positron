/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { DomSlot } from '../../browser/positronWelcomePage/components/domSlot.js';

describe('DomSlot', () => {
	const rtl = setupRTLRenderer();

	/**
	 * Builds an element standing in for one the editor pane hands to the page,
	 * such as the recent list or the show on startup checkbox.
	 */
	const slottedElement = () => {
		const element = document.createElement('div');
		element.textContent = 'Recent';
		return element;
	};

	it('places the element inside a bare wrapper when given no class', () => {
		const element = slottedElement();
		rtl.render(<DomSlot element={element} />);

		// The recent list and the connect action are slotted this way: the page's
		// flex gap spaces them, so their wrappers carry no class.
		expect(element).toBeInTheDocument();
		expect(element.parentElement).not.toHaveAttribute('class');
	});

	it('puts the given class on the wrapper', () => {
		const element = slottedElement();
		rtl.render(<DomSlot className='positron-welcome-page-footer' element={element} />);

		expect(element.parentElement).toHaveClass('positron-welcome-page-footer');
	});

	it('removes the element when unmounted', () => {
		const element = slottedElement();
		const { unmount } = rtl.render(<DomSlot element={element} />);
		unmount();

		expect(element).not.toBeInTheDocument();
	});
});
