/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import React from 'react';
import { act } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { NotebookErrorBoundary } from '../../browser/NotebookErrorBoundary.js';
import { ILogService } from '../../../../../platform/log/common/log.js';

function ThrowingComponent({ error }: { error: Error }): never {
	throw error;
}

function ThrowingNonErrorComponent({ value }: { value: unknown }): never {
	throw value;
}

function GoodComponent() {
	return <div className='good-component'>Hello</div>;
}

function ThrowingProvider({ children: _children }: { children: React.ReactNode }): never {
	throw new Error('provider error');
}

function createMockLogService() {
	const errorSpy = vi.fn();
	const logService = { error: errorSpy } as unknown as ILogService;
	return { logService, errorSpy };
}

/** Click a button and flush React state updates synchronously. */
function clickAndFlush(element: HTMLElement): void {
	act(() => { element.click(); });
}

describe('NotebookErrorBoundary', () => {
	const rtl = setupRTLRenderer();

	describe('when children render successfully', () => {
		it('renders children', () => {
			const { logService } = createMockLogService();
			const { getByText } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<GoodComponent />
				</NotebookErrorBoundary>
			);

			getByText('Hello');
		});
	});

	describe('when children throw during render', () => {
		// React logs console.error when an error boundary catches. The test
		// runner treats unexpected console output as a failure.
		let originalConsoleError: typeof console.error;
		beforeEach(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		afterEach(() => {
			console.error = originalConsoleError;
		});

		it('displays fallback error UI with role=alert', () => {
			const { logService } = createMockLogService();
			const { getByRole } = rtl.render(
				<NotebookErrorBoundary componentName='TestCell' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('render failed')} />
				</NotebookErrorBoundary>
			);

			getByRole('alert');
		});

		it('applies level-specific CSS class and message', () => {
			const cases: Array<{ level: 'output' | 'cell' | 'editor'; message: string }> = [
				{ level: 'output', message: 'Something went wrong rendering this output.' },
				{ level: 'cell', message: 'Something went wrong rendering this cell.' },
				{ level: 'editor', message: 'Something went wrong rendering this notebook.' },
			];

			for (const { level, message } of cases) {
				const { logService } = createMockLogService();
				const rendered = level === 'editor'
					? rtl.render(
						<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={() => { }}>
							<ThrowingComponent error={new Error('fail')} />
						</NotebookErrorBoundary>
					)
					: rtl.render(
						<NotebookErrorBoundary componentName='Test' level={level} logService={logService}>
							<ThrowingComponent error={new Error('fail')} />
						</NotebookErrorBoundary>
					);

				// Level-specific class is structural; no semantic handle exposes the level.
				expect(rendered.container.querySelector(`.notebook-error-boundary-${level}`)).toBeInTheDocument();
				expect(rendered.getByText(message)).toBeInTheDocument();
				rendered.unmount();
			}
		});

		it('logs error via logService', () => {
			const { logService, errorSpy } = createMockLogService();
			rtl.render(
				<NotebookErrorBoundary componentName='MyCell' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('render failed')} />
				</NotebookErrorBoundary>
			);

			expect(errorSpy).toHaveBeenCalledOnce();
			const logMessage = errorSpy.mock.calls[0][0] as string;
			expect(logMessage, 'Log should include component name').toContain('MyCell');
			expect(logMessage, 'Log should include level').toContain('cell');
			expect(logMessage, 'Log should include error message').toContain('render failed');
		});

		it('handles non-Error thrown values gracefully', () => {
			const { logService, errorSpy } = createMockLogService();
			const { getByRole } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingNonErrorComponent value='string error' />
				</NotebookErrorBoundary>
			);

			// Should still show error UI
			getByRole('alert');

			// Should log safely without crashing
			expect(errorSpy).toHaveBeenCalledOnce();
			const logMessage = errorSpy.mock.calls[0][0] as string;
			expect(logMessage, 'Log should include stringified thrown value').toContain('string error');

			// Details should show the stringified value
			clickAndFlush(getByRole('button', { name: 'Show Details' }));
			expect(getByRole('alert')).toHaveTextContent('string error');
		});
	});

	describe('Show Details toggle', () => {
		let originalConsoleError: typeof console.error;
		beforeEach(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		afterEach(() => {
			console.error = originalConsoleError;
		});

		it('details are hidden by default', () => {
			const { logService } = createMockLogService();
			const { getByRole, queryByRole } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			// Toggle button starts in "Show Details" state, meaning details are hidden.
			getByRole('button', { name: 'Show Details' });
			expect(queryByRole('button', { name: 'Hide Details' })).not.toBeInTheDocument();
		});

		it('clicking toggle reveals error message then hides it', () => {
			const { logService } = createMockLogService();
			const { getByRole, queryByRole } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('specific error message')} />
				</NotebookErrorBoundary>
			);

			// Show details
			clickAndFlush(getByRole('button', { name: 'Show Details' }));
			getByRole('button', { name: 'Hide Details' });
			expect(getByRole('alert')).toHaveTextContent('specific error message');

			// Hide details
			clickAndFlush(getByRole('button', { name: 'Hide Details' }));
			getByRole('button', { name: 'Show Details' });
			expect(queryByRole('button', { name: 'Hide Details' })).not.toBeInTheDocument();
		});
	});

	describe('Retry (output and cell levels)', () => {
		let originalConsoleError: typeof console.error;
		beforeEach(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		afterEach(() => {
			console.error = originalConsoleError;
		});

		it('shows Retry button for cell and output levels', () => {
			for (const level of ['cell', 'output'] as const) {
				const { logService } = createMockLogService();
				const { getByRole, unmount } = rtl.render(
					<NotebookErrorBoundary componentName='Test' level={level} logService={logService}>
						<ThrowingComponent error={new Error('fail')} />
					</NotebookErrorBoundary>
				);

				expect(
					getByRole('button', { name: 'Retry' }),
					`Retry button should exist for ${level} level`
				).toBeInTheDocument();
				unmount();
			}
		});

		it('clicking Retry re-renders children', () => {
			const { logService } = createMockLogService();
			let shouldThrow = true;

			function ConditionallyThrowingComponent() {
				if (shouldThrow) {
					throw new Error('fail');
				}
				return <div className='recovered'>Recovered</div>;
			}

			const { getByRole, getByText, queryByRole } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ConditionallyThrowingComponent />
				</NotebookErrorBoundary>
			);

			getByRole('alert');

			// Fix the component and retry
			shouldThrow = false;
			clickAndFlush(getByRole('button', { name: 'Retry' }));

			getByText('Recovered');
			expect(queryByRole('alert'), 'Error UI should be gone').not.toBeInTheDocument();
		});
	});

	describe('Reload (editor level)', () => {
		let originalConsoleError: typeof console.error;
		beforeEach(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		afterEach(() => {
			console.error = originalConsoleError;
		});

		it('clicking Reload calls onReload callback', () => {
			const { logService } = createMockLogService();
			const onReload = vi.fn();
			const { getByRole } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={onReload}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			clickAndFlush(getByRole('button', { name: 'Reload' }));

			expect(onReload).toHaveBeenCalledOnce();
		});
	});

	describe('boundary wrapping providers', () => {
		let originalConsoleError: typeof console.error;
		beforeEach(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		afterEach(() => {
			console.error = originalConsoleError;
		});

		it('catches errors from provider components when boundary wraps them', () => {
			const { logService, errorSpy } = createMockLogService();
			const { getByRole } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={() => { }}>
					<ThrowingProvider>
						<GoodComponent />
					</ThrowingProvider>
				</NotebookErrorBoundary>
			);

			expect(
				getByRole('alert'),
				'Error boundary should catch provider errors'
			).toBeInTheDocument();
			expect(errorSpy).toHaveBeenCalledOnce();
			const logMessage = errorSpy.mock.calls[0][0] as string;
			expect(logMessage, 'Log should include the provider error message').toContain('provider error');
		});

	});
});
