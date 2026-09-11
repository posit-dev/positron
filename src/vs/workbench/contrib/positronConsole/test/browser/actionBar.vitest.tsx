/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { DynamicActionBarAction } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';

// The real PositronDynamicActionBar lays its actions out by measured width,
// which is 0 in jsdom, so it renders nothing. Render the action components
// directly instead so the buttons are present.
vi.mock('../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js')>();
	return {
		...actual,
		PositronDynamicActionBar: ({ leftActions, rightActions }: { leftActions: DynamicActionBarAction[]; rightActions: DynamicActionBarAction[] }) => (
			<div>
				{[...leftActions, ...rightActions].map((action, i) => (
					<div key={i}>{typeof action.component === 'function' ? action.component() : action.component}</div>
				))}
			</div>
		),
	};
});
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronConsoleService, PositronConsoleState, SessionAttachMode } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IResourceUsageHistoryService } from '../../../../services/positronConsole/browser/resourceUsageHistoryService.js';
import { TestPositronConsoleInstance, TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ActionBar } from '../../browser/components/actionBar.js';
import { PositronConsoleContextProvider } from '../../browser/positronConsoleContext.js';

describe('ActionBar', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IResourceUsageHistoryService, { getHistory: async () => [] })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const container = stubInterface<IReactComponentContainer>();

	// Disposes emitters created for busy sessions.
	const disposables = new DisposableStore();
	afterEach(() => disposables.clear());

	// Adds a busy, attached console session whose runtime is executing a
	// command. Returns a callback that fires the runtime's Busy state change,
	// which is what surfaces the interrupt button.
	function addBusyConsoleInstance(sessionId: string): { fireBusy: () => void } {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId,
			sessionMode: LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
			createdTimestamp: 0,
			startReason: 'test',
		};
		const runtimeMetadata = stubInterface<ILanguageRuntimeMetadata>({
			languageName: 'Python',
			languageId: 'python',
			base64EncodedIconSvg: undefined,
		});
		const instance = new TestPositronConsoleInstance(sessionId, 'Python', sessionMetadata, runtimeMetadata);
		const runtimeStateEmitter = disposables.add(new Emitter<RuntimeState>());
		// The runtime reports Busy while executing, but dynState.busy stays
		// false: it's a separate UI-comm signal that not every runtime emits
		// (Python never does), so it can't gate the interrupt button.
		const busySession = stubInterface<ILanguageRuntimeSession>({
			sessionId,
			getRuntimeState: () => RuntimeState.Busy,
			onDidChangeRuntimeState: runtimeStateEmitter.event,
			onDidReceiveRuntimeClientEvent: Event.None,
			dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ busy: false, currentWorkingDirectory: '' }),
		});
		instance.attachRuntimeSession(busySession, SessionAttachMode.Connected);
		instance.setState(PositronConsoleState.Busy);

		const consoleService = ctx.get(IPositronConsoleService) as TestPositronConsoleService;
		consoleService.addTestConsoleInstance(instance);
		return { fireBusy: () => runtimeStateEmitter.fire(RuntimeState.Busy) };
	}

	// Adds an idle, attached console session and makes it the active instance,
	// so the restart button renders enabled.
	function addIdleConsoleInstance(sessionId: string): TestPositronConsoleInstance {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId,
			sessionMode: LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
			createdTimestamp: 0,
			startReason: 'test',
		};
		const runtimeMetadata = stubInterface<ILanguageRuntimeMetadata>({
			languageName: 'Python',
			languageId: 'python',
			base64EncodedIconSvg: undefined,
		});
		const instance = new TestPositronConsoleInstance(sessionId, 'Python', sessionMetadata, runtimeMetadata);
		const idleSession = stubInterface<ILanguageRuntimeSession>({
			sessionId,
			getRuntimeState: () => RuntimeState.Idle,
			onDidChangeRuntimeState: Event.None,
			onDidReceiveRuntimeClientEvent: Event.None,
			dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ busy: false, currentWorkingDirectory: '' }),
		});
		instance.attachRuntimeSession(idleSession, SessionAttachMode.Connected);
		instance.setState(PositronConsoleState.Ready);

		const consoleService = ctx.get(IPositronConsoleService) as TestPositronConsoleService;
		consoleService.addTestConsoleInstance(instance);
		return instance;
	}

	it('re-enables the restart button after a restart request fails', async () => {
		// A slow restart can have restartSession reject (e.g. the readiness
		// timeout fires) even though the kernel eventually comes back. The
		// button must not stay stuck disabled.
		const restartSession = vi
			.spyOn(ctx.reactServices.runtimeSessionService, 'restartSession')
			.mockRejectedValue(new Error('Timed out waiting for runtime to be ready.'));
		addIdleConsoleInstance('s1');
		const user = userEvent.setup();

		rtl.render(
			<PositronConsoleContextProvider>
				<ActionBar reactComponentContainer={container} />
			</PositronConsoleContextProvider>
		);

		const restartButton = screen.getByRole('button', { name: /Restart/ });
		expect(restartButton).toBeEnabled();

		await user.click(restartButton);

		expect(restartSession).toHaveBeenCalledOnce();
		await waitFor(() => expect(restartButton).toBeEnabled());
	});

	it('keeps the interrupt button after switching consoles and back', () => {
		const consoleService = ctx.get(IPositronConsoleService) as TestPositronConsoleService;
		const busy = addBusyConsoleInstance('busy');
		addIdleConsoleInstance('idle');

		// Start on the busy console.
		act(() => consoleService.setActivePositronConsoleSession('busy'));

		rtl.render(
			<PositronConsoleContextProvider>
				<ActionBar reactComponentContainer={container} />
			</PositronConsoleContextProvider>
		);

		// The running command surfaces the interrupt button.
		act(() => busy.fireBusy());
		expect(screen.getByRole('button', { name: /Interrupt/ })).toBeInTheDocument();

		// Switch to the idle console: no command running, no interrupt button.
		act(() => consoleService.setActivePositronConsoleSession('idle'));
		expect(screen.queryByRole('button', { name: /Interrupt/ })).not.toBeInTheDocument();

		// Switch back to the still-busy console: the interrupt button must return.
		act(() => consoleService.setActivePositronConsoleSession('busy'));
		expect(screen.getByRole('button', { name: /Interrupt/ })).toBeInTheDocument();
	});
});
