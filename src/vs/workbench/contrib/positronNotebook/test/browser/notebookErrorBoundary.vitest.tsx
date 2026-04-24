/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { act, screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { NotebookErrorBoundary } from '../../browser/NotebookErrorBoundary.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';

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
	const logService = new NullLogService();
	const errorSpy = vi.spyOn(logService, 'error');
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
			rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<GoodComponent />
				</NotebookErrorBoundary>
			);

			expect(screen.getByText('Hello')).toBeInTheDocument();
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
			rtl.render(
				<NotebookErrorBoundary componentName='TestCell' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('render failed')} />
				</NotebookErrorBoundary>
			);

			expect(screen.getByRole('alert')).toBeInTheDocument();
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

				expect(screen.getByRole('alert')).toHaveClass(`notebook-error-boundary-${level}`);
				expect(screen.getByText(message)).toBeInTheDocument();
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
			rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingNonErrorComponent value='string error' />
				</NotebookErrorBoundary>
			);

			// Should still show error UI
			expect(screen.getByRole('alert')).toBeInTheDocument();

			// Should log safely without crashing
			expect(errorSpy).toHaveBeenCalledOnce();
			const logMessage = errorSpy.mock.calls[0][0] as string;
			expect(logMessage, 'Log should include stringified thrown value').toContain('string error');

			// Details should show the stringified value
			clickAndFlush(screen.getByRole('button', { name: 'Show Details' }));
			expect(screen.getByRole('alert')).toHaveTextContent('string error');
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
			rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			// Toggle button starts in "Show Details" state, meaning details are hidden.
			expect(screen.getByRole('button', { name: 'Show Details' })).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Hide Details' })).not.toBeInTheDocument();
		});

		it('clicking toggle reveals error message then hides it', () => {
			const { logService } = createMockLogService();
			rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('specific error message')} />
				</NotebookErrorBoundary>
			);

			// Show details
			clickAndFlush(screen.getByRole('button', { name: 'Show Details' }));
			expect(screen.getByRole('button', { name: 'Hide Details' })).toBeInTheDocument();
			expect(screen.getByRole('alert')).toHaveTextContent('specific error message');

			// Hide details
			clickAndFlush(screen.getByRole('button', { name: 'Hide Details' }));
			expect(screen.getByRole('button', { name: 'Show Details' })).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Hide Details' })).not.toBeInTheDocument();
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

		// it.each so a failure identifies which level regressed
		// (getByRole throws on miss without naming the iteration variable).
		it.each(['cell', 'output'] as const)('shows Retry button for %s level', (level) => {
			const { logService } = createMockLogService();
			rtl.render(
				<NotebookErrorBoundary componentName='Test' level={level} logService={logService}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
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

			rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ConditionallyThrowingComponent />
				</NotebookErrorBoundary>
			);

			expect(screen.getByRole('alert')).toBeInTheDocument();

			// Fix the component and retry
			shouldThrow = false;
			clickAndFlush(screen.getByRole('button', { name: 'Retry' }));

			// Children should re-render after retry.
			expect(screen.getByText('Recovered')).toBeInTheDocument();
			expect(screen.queryByRole('alert'), 'Error UI should be gone').not.toBeInTheDocument();
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
			rtl.render(
				<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={onReload}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			clickAndFlush(screen.getByRole('button', { name: 'Reload' }));

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
			rtl.render(
				<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={() => { }}>
					<ThrowingProvider>
						<GoodComponent />
					</ThrowingProvider>
				</NotebookErrorBoundary>
			);

			// Error boundary should catch provider errors.
			expect(screen.getByRole('alert')).toBeInTheDocument();
			expect(errorSpy).toHaveBeenCalledOnce();
			const logMessage = errorSpy.mock.calls[0][0] as string;
			expect(logMessage, 'Log should include the provider error message').toContain('provider error');
		});

	});
});
