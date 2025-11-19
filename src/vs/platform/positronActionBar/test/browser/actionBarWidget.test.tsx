/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import assert from 'assert';
import sinon from 'sinon';
import { createRoot, Root } from 'react-dom/client';
import { ActionBarWidget } from '../../browser/components/actionBarWidget.js';
import { IPositronActionBarWidgetDescriptor } from '../../browser/positronActionBarWidgetRegistry.js';
import { MenuId } from '../../../actions/common/actions.js';
import { ICommandService } from '../../../commands/common/commands.js';
import { ServicesAccessor } from '../../../instantiation/common/instantiation.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { PositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
/**
 * Creates a minimal mock ServicesAccessor for testing.
 */
function createMockServicesAccessor(commandService?: ICommandService): ServicesAccessor {
	const mockCommandService = commandService || {
		executeCommand: sinon.stub().resolves()
	} as any;

	return {
		get: (serviceId: any) => {
			if (serviceId === ICommandService) {
				return mockCommandService;
			}
			throw new Error(`Service ${serviceId} not mocked`);
		}
	} as any;
}

/**
 * Helper to render ActionBarWidget with context.
 */
function renderWidget(
	root: Root,
	descriptor: IPositronActionBarWidgetDescriptor,
	servicesAccessor: ServicesAccessor
) {
	root.render(
		<PositronReactServicesContext.Provider value={servicesAccessor as any}>
			<ActionBarWidget descriptor={descriptor} />
		</PositronReactServicesContext.Provider>
	);
}

suite('ActionBarWidget', () => {
	let root: Root;
	let container: HTMLElement;
	let mockServicesAccessor: ServicesAccessor;
	let commandService: ICommandService;

	setup(() => {
		// Create a container element for React to render into
		container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		root = createRoot(container);

		// Create mock command service
		commandService = {
			executeCommand: sinon.stub().resolves()
		} as unknown as ICommandService;

		mockServicesAccessor = createMockServicesAccessor(commandService);
	});

	teardown(() => {
		// Clean up the React root and container
		if (root) {
			root.unmount();
		}
		if (container && container.parentNode) {
			container.parentNode.removeChild(container);
		}
		// Restore spies and stubs
		sinon.restore();
	});

	test('renders a simple widget component', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => <span className='test-widget-content'>Test Widget</span>
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const widgetContent = container.querySelector('.test-widget-content');
		assert.ok(widgetContent, 'Expected to find widget content');
		assert.strictEqual(widgetContent.textContent, 'Test Widget');
	});

	test('widget can access services via accessor', async () => {
		let receivedAccessor: ServicesAccessor | undefined;

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.service.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: (accessor) => {
				receivedAccessor = accessor;
				return () => <span className='service-widget'>Has Services</span>;
			}
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.ok(receivedAccessor, 'Widget should receive services accessor');
		assert.strictEqual(receivedAccessor, mockServicesAccessor);
	});

	test('command-driven widget renders as button', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.command.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.command',
			ariaLabel: 'Test Command',
			tooltip: 'Execute test command',
			componentFactory: () => () => <span>Command Widget</span>
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const button = container.querySelector('button.action-bar-widget');
		assert.ok(button, 'Expected to find button element');
		assert.strictEqual(button.getAttribute('aria-label'), 'Test Command');
		assert.strictEqual(button.getAttribute('title'), 'Execute test command');
	});

	test('command-driven widget executes command on click', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.clickable.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.click.command',
			commandArgs: { arg1: 'value1' },
			ariaLabel: 'Clickable Widget',
			componentFactory: () => () => <span>Click Me</span>
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const button = container.querySelector('button.action-bar-widget') as HTMLButtonElement;
		assert.ok(button, 'Expected to find button');

		// Simulate click
		button.click();

		// Wait for click handler
		await new Promise(resolve => setTimeout(resolve, 0));

		const executeCommandStub = commandService.executeCommand as sinon.SinonStub;
		assert.ok(executeCommandStub.calledOnce, 'Command should be executed once');
		assert.ok(
			executeCommandStub.calledWith('test.click.command', { arg1: 'value1' }),
			'Command should be called with correct arguments'
		);
	});

	test('command-driven widget executes command on Enter key', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.keyboard.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.keyboard.command',
			ariaLabel: 'Keyboard Widget',
			componentFactory: () => () => <span>Press Enter</span>
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const button = container.querySelector('button.action-bar-widget') as HTMLButtonElement;
		assert.ok(button, 'Expected to find button');

		// Simulate Enter key press
		const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
		button.dispatchEvent(enterEvent);

		// Wait for event handler
		await new Promise(resolve => setTimeout(resolve, 0));

		const executeCommandStub = commandService.executeCommand as sinon.SinonStub;
		assert.ok(executeCommandStub.calledOnce, 'Command should be executed on Enter');
	});

	test('command-driven widget executes command on Space key', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.space.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.space.command',
			ariaLabel: 'Space Widget',
			componentFactory: () => () => <span>Press Space</span>
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const button = container.querySelector('button.action-bar-widget') as HTMLButtonElement;
		assert.ok(button, 'Expected to find button');

		// Simulate Space key press
		const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
		button.dispatchEvent(spaceEvent);

		// Wait for event handler
		await new Promise(resolve => setTimeout(resolve, 0));

		const executeCommandStub = commandService.executeCommand as sinon.SinonStub;
		assert.ok(executeCommandStub.calledOnce, 'Command should be executed on Space');
	});

	test('self-contained widget renders as div (not button)', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.selfcontained.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			selfContained: true,
			componentFactory: () => () => <span>Self Contained</span>
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const div = container.querySelector('div.action-bar-widget');
		assert.ok(div, 'Expected to find div element');

		const button = container.querySelector('button.action-bar-widget');
		assert.strictEqual(button, null, 'Should not render as button when self-contained');
	});

	test('legacy widget (no command, not self-contained) renders as div', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.legacy.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			// No commandId, not selfContained
			componentFactory: () => () => <span>Legacy Widget</span>
		};

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const div = container.querySelector('div.action-bar-widget');
		assert.ok(div, 'Expected to find div element for legacy widget');

		const button = container.querySelector('button.action-bar-widget');
		assert.strictEqual(button, null, 'Legacy widget should not render as button');
	});

	test('error boundary catches widget errors and shows error indicator', async () => {
		// Create a component that throws an error
		const ErrorComponent = () => {
			throw new Error('Test widget error');
		};

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.error.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => ErrorComponent
		};

		// Suppress console.error for this test since we expect an error
		const consoleErrorStub = sinon.stub(console, 'error');

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for error boundary to catch error
		await new Promise(resolve => setTimeout(resolve, 0));

		const errorIndicator = container.querySelector('.action-bar-widget-error');
		assert.ok(errorIndicator, 'Expected to find error indicator');

		const errorIcon = errorIndicator.querySelector('.codicon-error');
		assert.ok(errorIcon, 'Expected to find error icon');

		// Verify error was logged
		assert.ok(consoleErrorStub.called, 'Error should be logged to console');

		consoleErrorStub.restore();
	});

	test('error boundary shows error message in title attribute', async () => {
		const ErrorComponent = () => {
			throw new Error('Specific error message');
		};

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.error.message.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => ErrorComponent
		};

		// Suppress console.error for this test
		const consoleErrorStub = sinon.stub(console, 'error');

		renderWidget(root, descriptor, mockServicesAccessor);

		// Wait for error boundary to catch error
		await new Promise(resolve => setTimeout(resolve, 0));

		const errorIndicator = container.querySelector('.action-bar-widget-error') as HTMLElement;
		assert.ok(errorIndicator, 'Expected to find error indicator');

		const title = errorIndicator.getAttribute('title');
		assert.ok(title, 'Expected error indicator to have title');
		assert.ok(title.includes('Specific error message'), 'Title should contain error message');

		consoleErrorStub.restore();
	});

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
