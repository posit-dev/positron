/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import React from 'react';
import { flushSync } from 'react-dom';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../base/test/browser/react.js';
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

suite('NotebookErrorBoundary', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('when children render successfully', () => {
		test('renders children', () => {
			const { logService } = createMockLogService();
			const container = render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<GoodComponent />
				</NotebookErrorBoundary>
			);

			assert.ok(container.querySelector<HTMLElement>('.good-component'));
		});
	});

	suite('when children throw during render', () => {
		// React logs console.error when an error boundary catches. The test
		// runner treats unexpected console output as a failure.
		let originalConsoleError: typeof console.error;
		setup(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		teardown(() => {
			console.error = originalConsoleError;
		});

		test('displays fallback error UI with role=alert', () => {
			const { logService } = createMockLogService();
			const container = render(
				<NotebookErrorBoundary componentName='TestCell' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('render failed')} />
				</NotebookErrorBoundary>
			);

			assert.ok(container.querySelector<HTMLElement>('[role="alert"]'));
		});

		test('applies level-specific CSS class and message', () => {
			const cases: Array<{ level: 'output' | 'cell' | 'editor'; message: string }> = [
				{ level: 'output', message: 'Something went wrong rendering this output.' },
				{ level: 'cell', message: 'Something went wrong rendering this cell.' },
				{ level: 'editor', message: 'Something went wrong rendering this notebook.' },
			];

			for (const { level, message } of cases) {
				const { logService } = createMockLogService();
				const container = level === 'editor'
					? render(
						<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={() => { }}>
							<ThrowingComponent error={new Error('fail')} />
						</NotebookErrorBoundary>
					)
					: render(
						<NotebookErrorBoundary componentName='Test' level={level} logService={logService}>
							<ThrowingComponent error={new Error('fail')} />
						</NotebookErrorBoundary>
					);

				assert.ok(
					container.querySelector<HTMLElement>(`.notebook-error-boundary-${level}`),
					`Expected CSS class for level "${level}"`
				);

				const header = container.querySelector<HTMLElement>('.notebook-error-boundary-header');
				assert.ok(
					header?.textContent?.includes(message),
					`Expected message for level "${level}"`
				);
			}
		});

		test('logs error via logService', () => {
			const { logService, errorSpy } = createMockLogService();
			render(
				<NotebookErrorBoundary componentName='MyCell' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('render failed')} />
				</NotebookErrorBoundary>
			);

			sinon.assert.calledOnce(errorSpy);
			const logMessage = errorSpy.firstCall.args[0] as string;
			assert.ok(logMessage.includes('MyCell'), 'Log should include component name');
			assert.ok(logMessage.includes('cell'), 'Log should include level');
			assert.ok(logMessage.includes('render failed'), 'Log should include error message');
		});

		test('handles non-Error thrown values gracefully', () => {
			const { logService, errorSpy } = createMockLogService();
			const container = render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingNonErrorComponent value='string error' />
				</NotebookErrorBoundary>
			);

			// Should still show error UI
			assert.ok(container.querySelector<HTMLElement>('[role="alert"]'));

			// Should log safely without crashing
			sinon.assert.calledOnce(errorSpy);
			const logMessage = errorSpy.firstCall.args[0] as string;
			assert.ok(logMessage.includes('string error'), 'Log should include stringified thrown value');

			// Details should show the stringified value
			const { toggleDetails } = getActionButtons(container);
			clickAndFlush(toggleDetails);
			const details = container.querySelector<HTMLElement>('.notebook-error-boundary-details');
			assert.ok(details?.textContent?.includes('string error'), 'Details should show stringified thrown value');
		});
	});

	suite('Show Details toggle', () => {
		let originalConsoleError: typeof console.error;
		setup(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		teardown(() => {
			console.error = originalConsoleError;
		});

		test('details are hidden by default', () => {
			const { logService } = createMockLogService();
			const container = render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			assert.strictEqual(container.querySelector<HTMLElement>('.notebook-error-boundary-details'), null);
		});

		test('clicking toggle reveals error message then hides it', () => {
			const { logService } = createMockLogService();
			const container = render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ThrowingComponent error={new Error('specific error message')} />
				</NotebookErrorBoundary>
			);

			const { toggleDetails } = getActionButtons(container);

			// Show details
			clickAndFlush(toggleDetails);
			const details = container.querySelector<HTMLElement>('.notebook-error-boundary-details');
			assert.ok(details, 'Details section should be visible after clicking');
			assert.ok(details!.textContent?.includes('specific error message'), 'Details should contain the error message');

			// Hide details
			clickAndFlush(toggleDetails);
			assert.strictEqual(container.querySelector<HTMLElement>('.notebook-error-boundary-details'), null);
		});
	});

	suite('Retry (output and cell levels)', () => {
		let originalConsoleError: typeof console.error;
		setup(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		teardown(() => {
			console.error = originalConsoleError;
		});

		test('shows Retry button for cell and output levels', () => {
			for (const level of ['cell', 'output'] as const) {
				const { logService } = createMockLogService();
				const container = render(
					<NotebookErrorBoundary componentName='Test' level={level} logService={logService}>
						<ThrowingComponent error={new Error('fail')} />
					</NotebookErrorBoundary>
				);

				const { action } = getActionButtons(container);
				assert.ok(action, `Action button should exist for ${level} level`);
			}
		});

		test('clicking Retry re-renders children', () => {
			const { logService } = createMockLogService();
			let shouldThrow = true;

			function ConditionallyThrowingComponent() {
				if (shouldThrow) {
					throw new Error('fail');
				}
				return <div className='recovered'>Recovered</div>;
			}

			const container = render(
				<NotebookErrorBoundary componentName='Test' level='cell' logService={logService}>
					<ConditionallyThrowingComponent />
				</NotebookErrorBoundary>
			);

			assert.ok(container.querySelector<HTMLElement>('[role="alert"]'));

			// Fix the component and retry
			shouldThrow = false;
			const { action } = getActionButtons(container);
			clickAndFlush(action);

			assert.ok(container.querySelector<HTMLElement>('.recovered'), 'Children should re-render after retry');
			assert.strictEqual(container.querySelector<HTMLElement>('[role="alert"]'), null, 'Error UI should be gone');
		});
	});

	suite('Reload (editor level)', () => {
		let originalConsoleError: typeof console.error;
		setup(() => {
			originalConsoleError = console.error;
			console.error = () => { };
		});
		teardown(() => {
			console.error = originalConsoleError;
		});

		test('clicking Reload calls onReload callback', () => {
			const { logService } = createMockLogService();
			const onReload = sinon.spy();
			const container = render(
				<NotebookErrorBoundary componentName='Test' level='editor' logService={logService} onReload={onReload}>
					<ThrowingComponent error={new Error('fail')} />
				</NotebookErrorBoundary>
			);

			const { action } = getActionButtons(container);
			clickAndFlush(action);

			sinon.assert.calledOnce(onReload);
		});
	});
});
