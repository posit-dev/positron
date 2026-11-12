/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CounterView } from '../../browser/components/counterView.js';
import { CounterService } from '../../browser/counterService.js';
import { ICounterService } from '../../common/counter.js';
import { trackSubscriptions } from './counterTestUtils.js';

describe('CounterView', () => {
	// One service for the suite: the stub is captured at describe scope, so
	// assertions below are relative to the value at the start of each test.
	const service = new CounterService(new InMemoryStorageService(), new TestConfigurationService());
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICounterService, service)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function value(): number {
		return service.store.getState().value;
	}

	it('shows changes made outside React', () => {
		rtl.render(<CounterView />);
		const expected = value() + 2;
		act(() => service.increment(2));
		expect(screen.getByRole('status', { name: 'Counter value' })).toHaveTextContent(new RegExp(`^${expected}$`));
	});

	it('buttons drive the service', async () => {
		const user = userEvent.setup();
		rtl.render(<CounterView />);
		const before = value();
		const amount = screen.getByRole('spinbutton', { name: 'Amount' });
		await user.clear(amount);
		await user.type(amount, '5');
		await user.click(screen.getByRole('button', { name: 'Increment' }));
		expect(value()).toBe(before + 5);
	});

	it('disables increment and decrement when the amount is cleared', async () => {
		const user = userEvent.setup();
		rtl.render(<CounterView />);
		await user.clear(screen.getByRole('spinbutton', { name: 'Amount' }));
		expect(screen.getByRole('button', { name: 'Increment' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Decrement' })).toBeDisabled();
	});

	it('stats do not re-render on undo', () => {
		rtl.render(<CounterView />);
		act(() => {
			service.increment();
			service.increment();
		});
		const renders = screen.getByTestId('counter-stats').getAttribute('data-render-count');
		act(() => service.undo());
		expect(screen.getByTestId('counter-stats')).toHaveAttribute('data-render-count', renders);
	});

	it('controls do not re-render once undo is enabled', () => {
		rtl.render(<CounterView />);
		act(() => service.increment());
		const renders = screen.getByTestId('counter-controls').getAttribute('data-render-count');
		act(() => {
			service.increment();
		});
		act(() => {
			service.increment();
		});
		expect(screen.getByTestId('counter-controls')).toHaveAttribute('data-render-count', renders);
	});

	it('unmounting removes every store subscription', () => {
		const activeSubscriptions = trackSubscriptions(service);
		const { unmount } = rtl.render(<CounterView />);
		expect(activeSubscriptions()).toBe(4);
		unmount();
		expect(activeSubscriptions()).toBe(0);
	});
});
