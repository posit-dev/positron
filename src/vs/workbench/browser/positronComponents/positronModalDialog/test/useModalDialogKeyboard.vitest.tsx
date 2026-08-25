/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { ReactNode, useMemo, useRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { useModalDialogKeyboard } from '../useModalDialogKeyboard.js';

/**
 * Renders the dialog shape the hook expects: a box with focusable children, and somewhere for the
 * keydowns to come from. A real dialog gets those keydowns from its modal renderer.
 */
function Harness(props: {
	onKeyDown: Event<KeyboardEvent>;
	onCancel?: () => void;
	enterHandledByCaller?: boolean;
	children: ReactNode;
}) {
	const dialogBoxRef = useRef<HTMLDivElement>(null);
	const keyboardSource = useMemo(() => ({ onKeyDown: props.onKeyDown }), [props.onKeyDown]);
	useModalDialogKeyboard({
		dialogBoxRef,
		keyboardSource,
		enterHandledByCaller: props.enterHandledByCaller,
		onCancel: props.onCancel
	});
	return <div ref={dialogBoxRef}>{props.children}</div>;
}

describe('useModalDialogKeyboard', () => {
	const disposables = ensureNoLeakedDisposables();

	let emitter: Emitter<KeyboardEvent>;
	let defaultButtonClicked: number;

	// The harness needs no services, so it renders through RTL directly rather than through
	// setupRTLRenderer. That helper is what normally registers the unmount between tests.
	afterEach(cleanup);

	beforeEach(() => {
		emitter = disposables.add(new Emitter<KeyboardEvent>());
		defaultButtonClicked = 0;
	});

	/**
	 * Delivers a keydown the way the renderer does, and reports whether the hook consumed it.
	 */
	function press(key: string, init: KeyboardEventInit = {}) {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
		const preventDefault = vi.spyOn(event, 'preventDefault');
		const stopPropagation = vi.spyOn(event, 'stopPropagation');
		emitter.fire(event);
		return { preventDefault, stopPropagation };
	}

	it('Escape calls onCancel and consumes the event', () => {
		const onCancel = vi.fn();
		render(<Harness onCancel={onCancel} onKeyDown={emitter.event}><button>OK</button></Harness>);

		const { preventDefault, stopPropagation } = press('Escape');

		expect({
			cancelled: onCancel.mock.calls.length,
			preventedDefault: preventDefault.mock.calls.length > 0,
			stoppedPropagation: stopPropagation.mock.calls.length > 0,
		}).toEqual({ cancelled: 1, preventedDefault: true, stoppedPropagation: true });
	});

	it('Enter clicks the first default button that is not disabled', () => {
		const onDisabledDefault = vi.fn();
		const onDefault = vi.fn();
		render(
			<Harness onKeyDown={emitter.event}>
				<button disabled className='default' onClick={onDisabledDefault}>Disabled default</button>
				<button className='default' onClick={onDefault}>Enabled default</button>
			</Harness>
		);

		press('Enter');

		expect({
			enabled: onDefault.mock.calls.length,
			disabled: onDisabledDefault.mock.calls.length,
		}).toEqual({ enabled: 1, disabled: 0 });
	});

	it('leaves Enter alone when the active element is a textarea, so a newline is not swallowed', () => {
		const onDefault = vi.fn();
		render(
			<Harness onKeyDown={emitter.event}>
				<textarea />
				<button className='default' onClick={onDefault}>OK</button>
			</Harness>
		);
		screen.getByRole('textbox').focus();

		const { preventDefault } = press('Enter');

		expect({
			clicked: onDefault.mock.calls.length,
			preventedDefault: preventDefault.mock.calls.length > 0,
		}).toEqual({ clicked: 0, preventedDefault: false });
	});

	it('leaves Enter alone entirely when the dialog handles it', () => {
		const onDefault = vi.fn();
		render(
			<Harness enterHandledByCaller onKeyDown={emitter.event}>
				<button className='default' onClick={onDefault}>OK</button>
			</Harness>
		);

		const { preventDefault } = press('Enter');

		expect({
			clicked: onDefault.mock.calls.length,
			preventedDefault: preventDefault.mock.calls.length > 0,
		}).toEqual({ clicked: 0, preventedDefault: false });
	});

	it('Tab wraps from the last focusable element back to the first', () => {
		render(
			<Harness onKeyDown={emitter.event}>
				<button>First</button>
				<button>Last</button>
			</Harness>
		);
		screen.getByText('Last').focus();

		press('Tab');

		expect(screen.getByText('First')).toHaveFocus();
	});

	it('Shift+Tab wraps from the first focusable element back to the last', () => {
		render(
			<Harness onKeyDown={emitter.event}>
				<button>First</button>
				<button>Last</button>
			</Harness>
		);
		screen.getByText('First').focus();

		press('Tab', { shiftKey: true });

		expect(screen.getByText('Last')).toHaveFocus();
	});

	it('consumes Tab when the dialog has nothing focusable, so focus cannot escape into the workbench', () => {
		render(<Harness onKeyDown={emitter.event}><span>no controls</span></Harness>);

		const { preventDefault, stopPropagation } = press('Tab');

		expect({
			preventedDefault: preventDefault.mock.calls.length > 0,
			stoppedPropagation: stopPropagation.mock.calls.length > 0,
		}).toEqual({ preventedDefault: true, stoppedPropagation: true });
	});

	it('unsubscribes on unmount, so a late keydown does nothing', () => {
		const onCancel = vi.fn();
		const { unmount } = render(<Harness onCancel={onCancel} onKeyDown={emitter.event}><button>OK</button></Harness>);

		unmount();
		press('Escape');

		expect(onCancel).not.toHaveBeenCalled();
	});

	it('treats a password field as focusable, so Tab does not throw focus back to the top', () => {
		// An input type left out of the focusable list is not merely skipped. The Tab handler reads
		// it as focus having escaped the dialog and sends focus to the first element, which strands
		// the user at the top and puts everything below the field out of keyboard reach.
		render(
			<Harness onKeyDown={emitter.event}>
				<button>First</button>
				<input type='password' />
				<button>Last</button>
			</Harness>
		);
		// A password input has no implicit ARIA role, so there is no semantic query for it.
		// eslint-disable-next-line no-restricted-syntax -- see above
		const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
		password.focus();

		press('Tab');

		// Focus is in the middle of the list, so the trap leaves it alone and the browser moves on.
		expect(password).toHaveFocus();
	});

	it('skips inert elements, which cannot take focus', () => {
		// A quick pick hosted inside a dialog marks the dialog's own children inert. Focusing an
		// inert element is a silent no-op, so Tab would appear dead.
		render(
			<Harness onKeyDown={emitter.event}>
				<div inert>
					<button>Inert first</button>
				</div>
				<button>Live first</button>
				<button>Live last</button>
			</Harness>
		);
		screen.getByText('Live last').focus();

		press('Tab');

		expect(screen.getByText('Live first')).toHaveFocus();
	});

	it('leaves Escape to a quick pick hosted inside the dialog', () => {
		// The quick pick sits on top of the dialog but never joins the renderer stack, so this hook
		// still sees its Escape. Closing the dialog here would discard what the user typed.
		const onCancel = vi.fn();
		render(
			<Harness onCancel={onCancel} onKeyDown={emitter.event}>
				<div className='quick-input-widget'>
					<input type='text' />
				</div>
			</Harness>
		);
		// The widget is identified by the class the quick pick actually carries, which is the
		// contract the hook keys off.
		// eslint-disable-next-line no-restricted-syntax -- see above
		const quickPickInput = document.querySelector<HTMLInputElement>('.quick-input-widget input')!;
		quickPickInput.focus();

		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		Object.defineProperty(event, 'target', { value: quickPickInput });
		const preventDefault = vi.spyOn(event, 'preventDefault');
		emitter.fire(event);

		expect({
			cancelled: onCancel.mock.calls.length,
			preventedDefault: preventDefault.mock.calls.length > 0,
		}).toEqual({ cancelled: 0, preventedDefault: false });
	});

	it('leaves Enter to a quick pick hosted inside the dialog', () => {
		// Enter in a file picker accepts the highlighted item. Clicking the dialog's default button
		// instead would submit the dialog with whatever path it already had.
		const onCancel = vi.fn();
		render(
			<Harness onCancel={onCancel} onKeyDown={emitter.event}>
				<div className='quick-input-widget'>
					<input type='text' />
				</div>
				<button className='default' onClick={() => defaultButtonClicked++}>OK</button>
			</Harness>
		);
		// eslint-disable-next-line no-restricted-syntax -- see above
		const quickPickInput = document.querySelector<HTMLInputElement>('.quick-input-widget input')!;
		quickPickInput.focus();

		const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		Object.defineProperty(event, 'target', { value: quickPickInput });
		const preventDefault = vi.spyOn(event, 'preventDefault');
		emitter.fire(event);

		expect({
			defaultButtonClicked,
			preventedDefault: preventDefault.mock.calls.length > 0,
		}).toEqual({ defaultButtonClicked: 0, preventedDefault: false });
	});

	it('ignores controls Tab can never reach, such as a negative tabIndex', () => {
		// A negative tabIndex means focusable from code only. Counting one as the last element makes
		// the trap wrap early, so everything after it becomes unreachable by keyboard. The notebook
		// assistant panel has exactly this: a submit button that is tabbable only once its prompt
		// box has content.
		render(
			<Harness onKeyDown={emitter.event}>
				<button>First</button>
				<button>Last tabbable</button>
				<button tabIndex={-1}>Programmatic only</button>
			</Harness>
		);
		screen.getByText('Last tabbable').focus();

		press('Tab');

		expect(screen.getByText('First')).toHaveFocus();
	});

	it('includes controls that are tabbable without a tabindex, such as a summary', () => {
		// A <summary> is tabbable in every browser but carries no tabindex and is not a button or
		// an input, so a hand-written tag list misses it. Anything the list misses is worse than
		// skipped: the trap reads it as focus escaping and throws focus back to the top. The
		// notebook assistant panel puts one between its settings and its actions.
		render(
			<Harness onKeyDown={emitter.event}>
				<button>First</button>
				<details><summary>Context</summary></details>
				<button>Last</button>
			</Harness>
		);
		screen.getByText('Context').focus();

		press('Tab');

		// Focus sits in the middle of the list, so the trap leaves it to the browser.
		expect(screen.getByText('Context')).toHaveFocus();
	});

	it('honors an explicit negative tabindex on a natively tabbable element', () => {
		// summary is in the backstop list, so without checking the attribute first the backstop
		// would override an author who deliberately took it out of the tab order.
		render(
			<Harness onKeyDown={emitter.event}>
				<button>First</button>
				<button>Last</button>
				<details><summary tabIndex={-1}>Not tabbable</summary></details>
			</Harness>
		);
		screen.getByText('Last').focus();

		press('Tab');

		expect(screen.getByText('First')).toHaveFocus();
	});
});
