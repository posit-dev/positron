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
	enterActivatesDefaultButton?: boolean;
	children: ReactNode;
}) {
	const dialogBoxRef = useRef<HTMLDivElement>(null);
	const keyboardSource = useMemo(() => ({ onKeyDown: props.onKeyDown }), [props.onKeyDown]);
	useModalDialogKeyboard({
		dialogBoxRef,
		keyboardSource,
		enterActivatesDefaultButton: props.enterActivatesDefaultButton,
		onCancel: props.onCancel
	});
	return <div ref={dialogBoxRef}>{props.children}</div>;
}

describe('useModalDialogKeyboard', () => {
	const disposables = ensureNoLeakedDisposables();

	let emitter: Emitter<KeyboardEvent>;

	// The harness needs no services, so it renders through RTL directly rather than through
	// setupRTLRenderer. That helper is what normally registers the unmount between tests.
	afterEach(cleanup);

	beforeEach(() => {
		emitter = disposables.add(new Emitter<KeyboardEvent>());
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

	it('leaves Enter alone entirely when enterActivatesDefaultButton is false', () => {
		const onDefault = vi.fn();
		render(
			<Harness enterActivatesDefaultButton={false} onKeyDown={emitter.event}>
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
});
