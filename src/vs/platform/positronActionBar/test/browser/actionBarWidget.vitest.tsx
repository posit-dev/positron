/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ActionBarWidget } from '../../browser/components/actionBarWidget.js';
import { IPositronActionBarWidgetDescriptor } from '../../browser/positronActionBarWidgetRegistry.js';
import { MenuId } from '../../../actions/common/actions.js';
import { ICommandEvent, ICommandService, CommandsRegistry } from '../../../commands/common/commands.js';
import { ServicesAccessor } from '../../../instantiation/common/instantiation.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

describe('ActionBarWidget', () => {
	// Minimal ICommandService stub: fires onWillExecuteCommand and resolves the
	// registered handler. Inlined here to keep tests decoupled from upstream
	// editor test helpers that require extra plumbing. Emitters are describe-
	// scope singletons (the stub captures their .event at build() time, so
	// they must outlive every test) -- disposed in afterAll below.
	const onWillExecuteCommand = new Emitter<ICommandEvent>();
	const onDidExecuteCommand = new Emitter<ICommandEvent>();
	const commandService = {
		onWillExecuteCommand: onWillExecuteCommand.event,
		onDidExecuteCommand: onDidExecuteCommand.event,
		executeCommand: async (id: string, ...args: unknown[]) => {
			const command = CommandsRegistry.getCommand(id);
			if (!command) {
				throw new Error(`command '${id}' not found`);
			}
			onWillExecuteCommand.fire({ commandId: id, args });
			onDidExecuteCommand.fire({ commandId: id, args });
			return undefined;
		},
	};

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, commandService)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	afterAll(() => {
		onWillExecuteCommand.dispose();
		onDidExecuteCommand.dispose();
	});

	it('renders a simple widget component', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => <span className='test-widget-content'>Test Widget</span>
		};

		rtl.render(<ActionBarWidget descriptor={descriptor} />);

		expect(screen.getByText('Test Widget')).toHaveClass('test-widget-content');
	});

	it('widget can access services via accessor', () => {
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

		rtl.render(<ActionBarWidget descriptor={descriptor} />);

		expect(receivedAccessor, 'Widget should receive services accessor').toBeDefined();
		// Verify the accessor resolves the stubbed ICommandService (proves it's the test container).
		expect(receivedAccessor!.get(ICommandService)).toBe(commandService);
	});

	it('command-driven widget renders as button', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.command.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.command',
			ariaLabel: 'Test Command',
			tooltip: 'Execute test command',
			componentFactory: () => () => <span>Command Widget</span>
		};

		rtl.render(<ActionBarWidget descriptor={descriptor} />);

		const button = screen.getByRole('button', { name: 'Test Command' });
		expect(button).toHaveClass('action-bar-widget');
		expect(button).toHaveAttribute('title', 'Execute test command');
	});

	it('command-driven widget executes command on click', async () => {
		// Register a test command
		ctx.disposables.add(CommandsRegistry.registerCommand('test.click.command', () => { }));

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.clickable.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.click.command',
			commandArgs: { arg1: 'value1' },
			ariaLabel: 'Clickable Widget',
			componentFactory: () => () => <span>Click Me</span>
		};

		rtl.render(<ActionBarWidget descriptor={descriptor} />);
		const button = screen.getByRole('button', { name: 'Clickable Widget' });

		// Simulate click
		const user = userEvent.setup();
		const commandPromise = Event.toPromise(commandService.onWillExecuteCommand);
		await user.click(button);

		// Wait for click handler
		const command = await commandPromise;
		expect(command.commandId).toBe('test.click.command');
		expect(command.args).toEqual([{ arg1: 'value1' }]);
	});

	it('command-driven widget executes command on Enter key', async () => {
		// Register a test command
		ctx.disposables.add(CommandsRegistry.registerCommand('test.keyboard.command', () => { }));

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.keyboard.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.keyboard.command',
			ariaLabel: 'Keyboard Widget',
			componentFactory: () => () => <span>Press Enter</span>
		};

		rtl.render(<ActionBarWidget descriptor={descriptor} />);
		const button = screen.getByRole('button', { name: 'Keyboard Widget' });

		// Simulate Enter key press. userEvent.keyboard dispatches to
		// document.activeElement, so confirm focus took hold before firing
		// keys -- otherwise a silently-ignored focus() call would make the
		// test time out on the Event.toPromise race rather than fail cleanly.
		const user = userEvent.setup();
		button.focus();
		expect(mainWindow.document.activeElement).toBe(button);
		const commandPromise = Event.toPromise(commandService.onWillExecuteCommand);
		await user.keyboard('{Enter}');

		const command = await commandPromise;
		expect(command.commandId).toBe('test.keyboard.command');
	});

	it('command-driven widget executes command on Space key', async () => {
		// Register a test command
		ctx.disposables.add(CommandsRegistry.registerCommand('test.space.command', () => { }));

		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.space.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			commandId: 'test.space.command',
			ariaLabel: 'Space Widget',
			componentFactory: () => () => <span>Press Space</span>
		};

		rtl.render(<ActionBarWidget descriptor={descriptor} />);
		const button = screen.getByRole('button', { name: 'Space Widget' });

		// Simulate Space key press. See the Enter test above for why we
		// assert focus before dispatching keys.
		const user = userEvent.setup();
		button.focus();
		expect(mainWindow.document.activeElement).toBe(button);
		const commandPromise = Event.toPromise(commandService.onWillExecuteCommand);
		await user.keyboard(' ');

		const command = await commandPromise;
		expect(command.commandId).toBe('test.space.command');
	});

	it('self-contained widget renders as div (not button)', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.selfcontained.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			selfContained: true,
			componentFactory: () => () => <span>Self Contained</span>
		};

		rtl.render(<ActionBarWidget descriptor={descriptor} />);

		// Inner content renders, wrapped in a div (not a button)
		const inner = screen.getByText('Self Contained');
		expect(inner.parentElement).toHaveClass('action-bar-widget');
		expect(inner.parentElement!.tagName).toBe('DIV');
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('legacy widget (no command, not self-contained) renders as div', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.legacy.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			// No commandId, not selfContained
			componentFactory: () => () => <span>Legacy Widget</span>
		};

		rtl.render(<ActionBarWidget descriptor={descriptor} />);

		const inner = screen.getByText('Legacy Widget');
		expect(inner.parentElement).toHaveClass('action-bar-widget');
		expect(inner.parentElement!.tagName).toBe('DIV');
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('error boundary catches widget errors and shows error indicator', () => {
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
		const consoleErrorStub = vi.spyOn(console, 'error').mockImplementation(() => { });

		// The error boundary renders a div with title="Widget error: ..." and a
		// codicon-error child; getByTitle reliably finds it. The icon span is
		// its only child so we read it via firstChild.
		rtl.render(<ActionBarWidget descriptor={descriptor} />);

		const errorIndicator = screen.getByTitle(/Widget error:/);
		expect(errorIndicator).toBeInTheDocument();
		expect(errorIndicator.firstChild).toHaveClass('codicon-error');

		// Verify error was logged
		expect(consoleErrorStub).toHaveBeenCalled();
	});

	it('error boundary shows error message in title attribute', () => {
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
		vi.spyOn(console, 'error').mockImplementation(() => { });

		rtl.render(<ActionBarWidget descriptor={descriptor} />);

		expect(screen.getByTitle(/Specific error message/)).toBeInTheDocument();
	});
});
