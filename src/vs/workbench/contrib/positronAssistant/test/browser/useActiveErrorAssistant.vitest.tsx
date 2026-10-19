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
import { useActiveErrorAssistant } from '../../browser/useActiveErrorAssistant.js';
import { IErrorAssistant, IErrorAssistantInfo, IErrorAssistantService } from '../../common/errorAssistant.js';
import { registerTestErrorAssistant } from './errorAssistantTestUtils.js';

function createAssistant(id: string): IErrorAssistant {
	return { id, label: id, supportsChatContinuation: true, run: async () => { } };
}

/** Renders the active assistant's label, and counts its renders. */
let renders = 0;
const ActiveAssistantLabel = () => {
	renders++;
	const assistant = useActiveErrorAssistant();
	return <span data-testid='label'>{assistant?.label ?? 'none'}</span>;
};

describe('useActiveErrorAssistant', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		renders = 0;
	});

	const label = () => screen.getByTestId('label').textContent;

	it('follows the active assistant as assistants register and unregister', () => {
		const first = registerTestErrorAssistant(ctx, createAssistant('first'));
		rtl.render(<ActiveAssistantLabel />);
		expect(label()).toBe('first');

		let second!: IDisposable;
		act(() => { second = ctx.get(IErrorAssistantService).register(createAssistant('second')); });
		expect(label()).toBe('first');

		act(() => first.dispose());
		expect(label()).toBe('second');

		act(() => second.dispose());
		expect(label()).toBe('none');
	});

	it('renders once on mount and once per change of the active assistant', () => {
		rtl.render(<ActiveAssistantLabel />);
		expect(renders).toBe(1);

		let registration!: IDisposable;
		act(() => { registration = registerTestErrorAssistant(ctx, createAssistant('first')); });
		expect(renders).toBe(2);

		act(() => registration.dispose());
		expect(renders).toBe(3);
	});

	describe('with a controllable service', () => {
		let activeAssistant: IErrorAssistantInfo | undefined;
		let emitter: Emitter<IErrorAssistantInfo | undefined>;
		let subscriptions: number;
		let unsubscriptions: number;

		beforeEach(() => {
			activeAssistant = undefined;
			emitter = ctx.disposables.add(new Emitter());
			subscriptions = 0;
			unsubscriptions = 0;
			ctx.instantiationService.stub(IErrorAssistantService, {
				get activeAssistant() { return activeAssistant; },
				onDidChangeActiveAssistant: (listener: (assistant: IErrorAssistantInfo | undefined) => void) => {
					subscriptions++;
					const disposable = emitter.event(listener);
					return toDisposable(() => {
						unsubscriptions++;
						disposable.dispose();
					});
				},
			});
		});

		const setActiveAssistant = (assistant: IErrorAssistantInfo | undefined) => {
			activeAssistant = assistant;
			emitter.fire(assistant);
		};

		it('picks up a change made after the first render but before subscribing', () => {
			// The assistant can change between the render that reads it and the
			// passive effect that subscribes, firing while no one is listening.
			// A sibling's layout effect runs in exactly that window.
			const ChangeOnLayout = () => {
				useLayoutEffect(() => setActiveAssistant(createAssistant('changed')), []);
				return null;
			};
			rtl.render(<><ActiveAssistantLabel /><ChangeOnLayout /></>);
			expect(label()).toBe('changed');
		});

		it('subscribes once across re-renders and unsubscribes on unmount', () => {
			const { rerender, unmount } = rtl.render(<ActiveAssistantLabel />);
			rerender(<ActiveAssistantLabel />);
			act(() => setActiveAssistant(createAssistant('first')));
			rerender(<ActiveAssistantLabel />);
			expect([subscriptions, unsubscriptions]).toEqual([1, 0]);

			unmount();
			expect([subscriptions, unsubscriptions]).toEqual([1, 1]);
		});

		it('shares one value across components when the assistant changes', () => {
			rtl.render(<><ActiveAssistantLabel /><ActiveAssistantLabel /></>);
			act(() => setActiveAssistant(createAssistant('first')));
			expect(screen.getAllByTestId('label').map(element => element.textContent)).toEqual(['first', 'first']);
		});
	});
});
