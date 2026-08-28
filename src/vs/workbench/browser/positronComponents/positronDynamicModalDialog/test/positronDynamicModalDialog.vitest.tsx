/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, cleanup, render, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { useState } from 'react';
import { PositronDynamicModalDialog, PositronDynamicModalDialogProps } from '../positronDynamicModalDialog.js';

describe('PositronDynamicModalDialog', () => {
	const disposables = ensureNoLeakedDisposables();

	// The dialog renders through a modal renderer in the app; these tests render it directly, so
	// they register the unmount that setupRTLRenderer would otherwise register.
	afterEach(cleanup);

	let resize: Emitter<UIEvent>;
	let keyDown: Emitter<KeyboardEvent>;

	beforeEach(() => {
		resize = disposables.add(new Emitter<UIEvent>());
		keyDown = disposables.add(new Emitter<KeyboardEvent>());
	});

	/**
	 * Renders the dialog with a stand-in for its renderer. The component reaches into the renderer
	 * only for its events, so an emitter is the whole surface it needs.
	 */
	function renderDialog(overrides: Partial<PositronDynamicModalDialogProps> = {}) {
		const renderer = stubInterface<PositronDynamicModalDialogProps['renderer']>({
			onKeyDown: keyDown.event,
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

	it('moves focus to the dialog box on mount rather than to a control inside it', () => {
		// The dialog opens with no control armed; the first Tab or Shift-Tab picks one. Focusing a
		// control would land on the title bar's close button, arming Enter to close the dialog.
		renderDialog({ onCancel: () => { } });

		expect(screen.getByRole('dialog')).toHaveFocus();
	});

	it('leaves focus where a control inside claimed it with autoFocus', () => {
		// This is how a dialog chooses what Enter does on arrival: footers autoFocus the button that
		// is safe to press.
		renderDialog({ footer: <button autoFocus>Cancel</button> });

		expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
	});

	it('does not mark the only open dialog as nested', () => {
		const { container } = renderDialog();

		// The container is a structural div with no role or text of its own, and the class is the
		// contract the CSS keys off, so there is no semantic query for it.
		// eslint-disable-next-line no-restricted-syntax -- see above
		expect(container.querySelector('.positron-dynamic-modal-dialog-box-container')).not.toHaveClass('nested');
	});

	it('marks a dialog opened while another is already open as nested', () => {
		const first = renderDialog();
		const second = renderDialog();

		// eslint-disable-next-line no-restricted-syntax -- structural div, see above
		expect(first.container.querySelector('.positron-dynamic-modal-dialog-box-container')).not.toHaveClass('nested');
		// eslint-disable-next-line no-restricted-syntax -- structural div, see above
		expect(second.container.querySelector('.positron-dynamic-modal-dialog-box-container')).toHaveClass('nested');
	});

	it('stops marking dialogs nested once the earlier ones have closed', () => {
		const first = renderDialog();
		const second = renderDialog();
		second.unmount();
		first.unmount();

		const third = renderDialog();

		// eslint-disable-next-line no-restricted-syntax -- structural div, see above
		expect(third.container.querySelector('.positron-dynamic-modal-dialog-box-container')).not.toHaveClass('nested');
	});

	it('Escape calls onCancel', () => {
		const onCancel = vi.fn();
		renderDialog({ onCancel });

		keyDown.fire(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('leaves Enter to the form rather than to a default button', () => {
		const onDefaultButton = vi.fn();
		renderDialog({ footer: <button className='default' onClick={onDefaultButton}>OK</button> });

		keyDown.fire(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

		expect(onDefaultButton).not.toHaveBeenCalled();
	});

	it('does not mark a dialog nested when it replaces one in the same commit', () => {
		// A multi-step flow renders a different component per step, each with its own dialog, so the
		// incoming dialog mounts and the outgoing one unmounts in the same commit. If the incoming
		// dialog decided its nesting during render it would see the outgoing one still counted, and
		// the workbench would stop being dimmed from step two onward.
		const renderer = stubInterface<PositronDynamicModalDialogProps['renderer']>({
			onKeyDown: keyDown.event,
			onResize: resize.event
		});
		const StepOne = () => (
			<PositronDynamicModalDialog content={<span>First step content</span>} renderer={renderer} title='One' width={400} />
		);
		const StepTwo = () => (
			<PositronDynamicModalDialog content={<span>Second step content</span>} renderer={renderer} title='Two' width={400} />
		);
		function Flow() {
			const [step, setStep] = useState(1);
			return (
				<>
					<button onClick={() => setStep(2)}>Next</button>
					{step === 1 ? <StepOne /> : <StepTwo />}
				</>
			);
		}
		const { container } = render(<Flow />);

		act(() => {
			screen.getByRole('button', { name: 'Next' }).click();
		});

		expect(screen.getByText('Second step content')).toBeInTheDocument();
		// eslint-disable-next-line no-restricted-syntax -- structural div, no semantic query
		expect(container.querySelector('.positron-dynamic-modal-dialog-box-container')).not.toHaveClass('nested');
	});
});
