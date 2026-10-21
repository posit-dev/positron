/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { useLayoutEffect } from 'react';
import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { useActiveErrorActionHandler } from '../../browser/useActiveErrorActionHandler.js';
import { IErrorActionHandler, IErrorActionHandlerInfo, IErrorActionHandlerService } from '../../common/errorAction.js';
import { registerTestErrorActionHandler } from './errorActionTestUtils.js';

function createHandler(id: string): IErrorActionHandler {
	return { id, label: id, supportsChatContinuation: true, ask: async () => { } };
}

/** Renders the active handler's label, and counts its renders. */
let renders = 0;
const ActiveHandlerLabel = () => {
	renders++;
	const handler = useActiveErrorActionHandler();
	return <span data-testid='label'>{handler?.label ?? 'none'}</span>;
};

describe('useActiveErrorActionHandler', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		renders = 0;
	});

	const label = () => screen.getByTestId('label');

	it('follows the chosen handler as it is chosen, registers, and unregisters', () => {
		registerTestErrorActionHandler(ctx, createHandler('first'));
		rtl.render(<ActiveHandlerLabel />);
		expect(label()).toHaveTextContent('first');

		let second!: IDisposable;
		act(() => { second = registerTestErrorActionHandler(ctx, { ...createHandler('second'), label: 'Second' }); });
		expect(label()).toHaveTextContent('Second');

		// Named by its id once it's gone.
		act(() => second.dispose());
		expect(label()).toHaveTextContent('second');
	});

	it('renders once on mount and once per change of the active handler', () => {
		rtl.render(<ActiveHandlerLabel />);
		expect(renders).toBe(1);

		let registration!: IDisposable;
		act(() => { registration = registerTestErrorActionHandler(ctx, createHandler('first')); });
		expect(renders).toBe(2);

		act(() => registration.dispose());
		expect(renders).toBe(3);
	});

	describe('with a controllable service', () => {
		let activeHandler: IErrorActionHandlerInfo | undefined;
		let emitter: Emitter<IErrorActionHandlerInfo | undefined>;
		let subscriptions: number;
		let unsubscriptions: number;

		beforeEach(() => {
			activeHandler = undefined;
			emitter = ctx.disposables.add(new Emitter());
			subscriptions = 0;
			unsubscriptions = 0;
			ctx.instantiationService.stub(IErrorActionHandlerService, {
				get activeHandler() { return activeHandler; },
				onDidChangeActiveHandler: (listener: (handler: IErrorActionHandlerInfo | undefined) => void) => {
					subscriptions++;
					const disposable = emitter.event(listener);
					return toDisposable(() => {
						unsubscriptions++;
						disposable.dispose();
					});
				},
			});
		});

		const setActiveHandler = (handler: IErrorActionHandlerInfo | undefined) => {
			activeHandler = handler;
			emitter.fire(handler);
		};

		it('picks up a change made after the first render but before subscribing', () => {
			// The handler can change between the render that reads it and the
			// passive effect that subscribes, firing while no one is listening.
			// A sibling's layout effect runs in exactly that window.
			const ChangeOnLayout = () => {
				useLayoutEffect(() => setActiveHandler(createHandler('changed')), []);
				return null;
			};
			rtl.render(<><ActiveHandlerLabel /><ChangeOnLayout /></>);
			expect(label()).toHaveTextContent('changed');
		});

		it('subscribes once across re-renders and unsubscribes on unmount', () => {
			const { rerender, unmount } = rtl.render(<ActiveHandlerLabel />);
			rerender(<ActiveHandlerLabel />);
			act(() => setActiveHandler(createHandler('first')));
			rerender(<ActiveHandlerLabel />);
			expect([subscriptions, unsubscriptions]).toEqual([1, 0]);

			unmount();
			expect([subscriptions, unsubscriptions]).toEqual([1, 1]);
		});

		it('shares one value across components when the handler changes', () => {
			rtl.render(<><ActiveHandlerLabel /><ActiveHandlerLabel /></>);
			act(() => setActiveHandler(createHandler('first')));
			const [one, two] = screen.getAllByTestId('label');
			expect(one).toHaveTextContent('first');
			expect(two).toHaveTextContent('first');
		});
	});
});
