/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */

import sinon from 'sinon';
import { ActionBarWidget } from '../../browser/components/actionBarWidget.js';
import { IPositronActionBarWidgetDescriptor } from '../../browser/positronActionBarWidgetRegistry.js';
import { MenuId } from '../../../actions/common/actions.js';
import { ICommandService, CommandsRegistry } from '../../../commands/common/commands.js';
import { ServiceIdentifier, ServicesAccessor } from '../../../instantiation/common/instantiation.js';
import { ensureNoLeakedDisposables } from '../../../../base/test/common/vitestUtils.js';
import { setupRTLRenderer } from '../../../../base/test/browser/reactTestingLibrary.js';
import { PositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../base/browser/positronReactServices.js';
import { TestCommandService } from '../../../../editor/test/browser/editorTestServices.js';
import { TestInstantiationService } from '../../../instantiation/test/common/instantiationServiceMock.js';
import { Event } from '../../../../base/common/event.js';

describe('ActionBarWidget', () => {
	const disposables = ensureNoLeakedDisposables();
	const rtl = setupRTLRenderer();

	let mockServicesAccessor: PositronReactServices;
	let commandService: TestCommandService;

	/** Helper to render ActionBarWidget with context. */
	function renderWidget(descriptor: IPositronActionBarWidgetDescriptor) {
		return rtl.render(
			<PositronReactServicesContext.Provider value={mockServicesAccessor}>
				<ActionBarWidget descriptor={descriptor} />
			</PositronReactServicesContext.Provider>
		);
	}

	beforeEach(() => {
		const instantiationService = disposables.add(new TestInstantiationService());
		commandService = new TestCommandService(instantiationService);
		mockServicesAccessor = ({
			get<T>(serviceId: ServiceIdentifier<T>): T {
				if (serviceId === ICommandService) {
					return commandService as T;
				}
				throw new Error(`Service ${serviceId} not mocked`);
			}
		} satisfies Partial<PositronReactServices>) as PositronReactServices;
	});

	afterEach(() => {
		sinon.restore();
	});

	it('renders a simple widget component', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => <span className='test-widget-content'>Test Widget</span>
		};

		const { container } = renderWidget(descriptor);

		const widgetContent = container.querySelector('.test-widget-content');
		expect(widgetContent).toBeTruthy();
		expect(widgetContent!.textContent).toBe('Test Widget');
	});

	it('widget can access services via accessor', async () => {
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

		renderWidget(descriptor);

		expect(receivedAccessor).toBeTruthy();
		expect(receivedAccessor).toBe(mockServicesAccessor);
	});

	it('command-driven widget renders as button', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.command.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.command',
			ariaLabel: 'Test Command',
			tooltip: 'Execute test command',
			componentFactory: () => () => <span>Command Widget</span>
		};

		const { container } = renderWidget(descriptor);

		const button = container.querySelector('button.action-bar-widget');
		expect(button).toBeTruthy();
		expect(button!.getAttribute('aria-label')).toBe('Test Command');
		expect(button!.getAttribute('title')).toBe('Execute test command');
	});

	it('command-driven widget executes command on click', async () => {
		// Register a test command
		disposables.add(CommandsRegistry.registerCommand('test.click.command', () => { }));

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.clickable.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.click.command',
			commandArgs: { arg1: 'value1' },
			ariaLabel: 'Clickable Widget',
			componentFactory: () => () => <span>Click Me</span>
		};

		const { container } = renderWidget(descriptor);

		const button = container.querySelector<HTMLButtonElement>('button.action-bar-widget');
		expect(button).toBeTruthy();

		// Simulate click
		const commandPromise = Event.toPromise(commandService.onWillExecuteCommand);
		button!.click();

		// Wait for click handler
		const command = await commandPromise;
		expect(command.commandId).toBe('test.click.command');
		expect(command.args).toEqual([{ arg1: 'value1' }]);
	});

	it('command-driven widget executes command on Enter key', async () => {
		// Register a test command
		disposables.add(CommandsRegistry.registerCommand('test.keyboard.command', () => { }));

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.keyboard.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.keyboard.command',
			ariaLabel: 'Keyboard Widget',
			componentFactory: () => () => <span>Press Enter</span>
		};

		const { container } = renderWidget(descriptor);

		const button = container.querySelector<HTMLButtonElement>('button.action-bar-widget');
		expect(button).toBeTruthy();

		// Simulate Enter key press
		const commandPromise = Event.toPromise(commandService.onWillExecuteCommand);
		const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
		button!.dispatchEvent(enterEvent);

		const command = await commandPromise;
		expect(command.commandId).toBe('test.keyboard.command');
	});

	it('command-driven widget executes command on Space key', async () => {
		// Register a test command
		disposables.add(CommandsRegistry.registerCommand('test.space.command', () => { }));

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.space.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.space.command',
			ariaLabel: 'Space Widget',
			componentFactory: () => () => <span>Press Space</span>
		};

		const { container } = renderWidget(descriptor);

		const button = container.querySelector<HTMLButtonElement>('button.action-bar-widget');
		expect(button).toBeTruthy();

		// Simulate Space key press
		const commandPromise = Event.toPromise(commandService.onWillExecuteCommand);
		const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
		button!.dispatchEvent(spaceEvent);

		const command = await commandPromise;
		expect(command.commandId).toBe('test.space.command');
	});

	it('self-contained widget renders as div (not button)', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.selfcontained.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			selfContained: true,
			componentFactory: () => () => <span>Self Contained</span>
		};

		const { container } = renderWidget(descriptor);

		const div = container.querySelector('div.action-bar-widget');
		expect(div).toBeTruthy();

		const button = container.querySelector('button.action-bar-widget');
		expect(button).toBe(null);
	});

	it('legacy widget (no command, not self-contained) renders as div', async () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.legacy.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			// No commandId, not selfContained
			componentFactory: () => () => <span>Legacy Widget</span>
		};

		const { container } = renderWidget(descriptor);

		const div = container.querySelector('div.action-bar-widget');
		expect(div).toBeTruthy();

		const button = container.querySelector('button.action-bar-widget');
		expect(button).toBe(null);
	});

	it('error boundary catches widget errors and shows error indicator', async () => {
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

		const { container } = renderWidget(descriptor);

		const errorIndicator = container.querySelector('.action-bar-widget-error');
		expect(errorIndicator).toBeTruthy();

		const errorIcon = errorIndicator!.querySelector('.codicon-error');
		expect(errorIcon).toBeTruthy();

		// Verify error was logged
		expect(consoleErrorStub.called).toBeTruthy();

		consoleErrorStub.restore();
	});

	it('error boundary shows error message in title attribute', async () => {
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

		const { container } = renderWidget(descriptor);

		const errorIndicator = container.querySelector<HTMLElement>('.action-bar-widget-error');
		expect(errorIndicator).toBeTruthy();

		const title = errorIndicator!.getAttribute('title');
		expect(title).toBeTruthy();
		expect(title!.includes('Specific error message')).toBeTruthy();

		consoleErrorStub.restore();
	});
});
