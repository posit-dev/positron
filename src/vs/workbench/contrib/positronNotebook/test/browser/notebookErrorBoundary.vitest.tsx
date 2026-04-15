/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import React from 'react';
import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { ensureNoLeakedDisposables } from '../../../../../base/test/common/vitestUtils.js';
import { setupRTLRenderer } from '../../../../../base/test/browser/reactTestingLibrary.js';
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
	const errorSpy = sinon.spy();
	const logService = { error: errorSpy } as unknown as ILogService;
	return { logService, errorSpy };
}

/**
 * The error fallback always renders exactly two .notebook-error-boundary-action
 * buttons: [0] = toggle details, [1] = retry or reload.
 */
function getActionButtons(container: HTMLElement) {
	const buttons = container.querySelectorAll<HTMLButtonElement>('.notebook-error-boundary-action');
	return { toggleDetails: buttons[0], action: buttons[1] };
}

/** Click a button and flush React state updates synchronously. */
function clickAndFlush(element: HTMLElement): void {
	flushSync(() => { element.click(); });
}

describe('NotebookErrorBoundary', () => {
	ensureNoLeakedDisposables();
	const rtl = setupRTLRenderer();

	describe('when children render successfully', () => {
		it('renders children', () => {
			const { logService } = createMockLogService();
			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<GoodComponent />
				</NotebookErrorBoundary>
			);

			expect(container.querySelector<HTMLElement>('.good-component')).toBeTruthy();
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
			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='TestCell' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('render failed')} />
				</NotebookErrorBoundary>
			);

			expect(container.querySelector<HTMLElement>('[role="alert"]')).toBeTruthy();
		});

		it('applies level-specific CSS class and message', () => {
			const cases: Array<{ level: 'output' | 'cell' | 'editor'; message: string }> = [
				{ level: 'output', message: 'Something went wrong rendering this output.' },
				{ level: 'cell', message: 'Something went wrong rendering this cell.' },
				{ level: 'editor', message: 'Something went wrong rendering this notebook.' },
			];

			for (const { level, message } of cases) {
				const { logService } = createMockLogService();
				const { container } = level === 'editor'
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

				expect(
					container.querySelector<HTMLElement>(`.notebook-error-boundary-${level}`)
				).toBeTruthy();

				const header = container.querySelector<HTMLElement>('.notebook-error-boundary-header');
				expect(
					header?.textContent?.includes(message)
				).toBeTruthy();
			}
		});

		it('logs error via logService', () => {
			const { logService, errorSpy } = createMockLogService();
			rtl.render(
				<NotebookErrorBoundary componentName='MyCell' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('render failed')} />
				</NotebookErrorBoundary>
			);

			sinon.assert.calledOnce(errorSpy);
			const logMessage = errorSpy.firstCall.args[0] as string;
			expect(logMessage.includes('MyCell')).toBeTruthy();
			expect(logMessage.includes('cell')).toBeTruthy();
			expect(logMessage.includes('render failed')).toBeTruthy();
		});

		it('handles non-Error thrown values gracefully', () => {
			const { logService, errorSpy } = createMockLogService();
			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingNonErrorComponent value='string error' />
				</NotebookErrorBoundary>
			);

			// Should still show error UI
			expect(container.querySelector<HTMLElement>('[role="alert"]')).toBeTruthy();

			// Should log safely without crashing
			sinon.assert.calledOnce(errorSpy);
			const logMessage = errorSpy.firstCall.args[0] as string;
			expect(logMessage.includes('string error')).toBeTruthy();

			// Details should show the stringified value
			const { toggleDetails } = getActionButtons(container);
			clickAndFlush(toggleDetails);
			const details = container.querySelector<HTMLElement>('.notebook-error-boundary-details');
			expect(details?.textContent?.includes('string error')).toBeTruthy();
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
			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			expect(container.querySelector<HTMLElement>('.notebook-error-boundary-details')).toBe(null);
		});

		it('clicking toggle reveals error message then hides it', () => {
			const { logService } = createMockLogService();
			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('specific error message')} />
				</NotebookErrorBoundary>
			);

			const { toggleDetails } = getActionButtons(container);

			// Show details
			clickAndFlush(toggleDetails);
			const details = container.querySelector<HTMLElement>('.notebook-error-boundary-details');
			expect(details).toBeTruthy();
			expect(details!.textContent?.includes('specific error message')).toBeTruthy();

			// Hide details
			clickAndFlush(toggleDetails);
			expect(container.querySelector<HTMLElement>('.notebook-error-boundary-details')).toBe(null);
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
				const { container } = rtl.render(
					<NotebookErrorBoundary componentName='Test' level={level} logService={logService}>
						<ThrowingComponent error={new Error('fail')} />
					</NotebookErrorBoundary>
				);

				const { action } = getActionButtons(container);
				expect(action).toBeTruthy();
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

			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ConditionallyThrowingComponent />
				</NotebookErrorBoundary>
			);

			expect(container.querySelector<HTMLElement>('[role="alert"]')).toBeTruthy();

			// Fix the component and retry
			shouldThrow = false;
			const { action } = getActionButtons(container);
			clickAndFlush(action);

			expect(container.querySelector<HTMLElement>('.recovered')).toBeTruthy();
			expect(container.querySelector<HTMLElement>('[role="alert"]')).toBe(null);
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
			const onReload = sinon.spy();
			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={onReload}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			const { action } = getActionButtons(container);
			clickAndFlush(action);

			sinon.assert.calledOnce(onReload);
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
			const { container } = rtl.render(
				<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={() => { }}>
					<ThrowingProvider>
						<GoodComponent />
					</ThrowingProvider>
				</NotebookErrorBoundary>
			);

			expect(
				container.querySelector<HTMLElement>('[role="alert"]')
			).toBeTruthy();
			sinon.assert.calledOnce(errorSpy);
			const logMessage = errorSpy.firstCall.args[0] as string;
			expect(logMessage.includes('provider error')).toBeTruthy();
		});

	});
});
