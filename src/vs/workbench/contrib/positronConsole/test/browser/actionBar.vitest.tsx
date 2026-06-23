/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
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
});
