/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { cleanup, render, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { PositronDynamicModalDialog, PositronDynamicModalDialogProps } from '../positronDynamicModalDialog.js';

describe('PositronDynamicModalDialog', () => {
	const disposables = ensureNoLeakedDisposables();

	// The dialog renders through a modal renderer in the app; these tests render it directly, so
	// they register the unmount that setupRTLRenderer would otherwise register.
	afterEach(cleanup);

	let resize: Emitter<UIEvent>;

	beforeEach(() => {
		resize = disposables.add(new Emitter<UIEvent>());
	});

	/**
	 * Renders the dialog with a stand-in for its renderer. The component reaches into the renderer
	 * only for its events, so an emitter is the whole surface it needs.
	 */
	function renderDialog(overrides: Partial<PositronDynamicModalDialogProps> = {}) {
		const renderer = stubInterface<PositronDynamicModalDialogProps['renderer']>({
			onResize: resize.event
		});
		return render(
			<PositronDynamicModalDialog
				content={<button>Inside</button>}
				renderer={renderer}
				title='My Dialog'
				width={400}
				{...overrides}
			/>
		);
	}

	it('exposes itself as a modal dialog named by its title', () => {
		renderDialog();

		const dialog = screen.getByRole('dialog');

		expect({
			ariaModal: dialog.getAttribute('aria-modal'),
			namedByTheTitle: dialog.getAttribute('aria-labelledby') === screen.getByText('My Dialog').id,
		}).toEqual({ ariaModal: 'true', namedByTheTitle: true });
	});

	it('moves focus to the first focusable element inside the dialog on mount', () => {
		renderDialog();

		expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
	});

	it('focuses the dialog box itself when it has nothing focusable inside', () => {
		renderDialog({ content: <span>nothing focusable</span> });

		expect(screen.getByRole('dialog')).toHaveFocus();
	});
});
