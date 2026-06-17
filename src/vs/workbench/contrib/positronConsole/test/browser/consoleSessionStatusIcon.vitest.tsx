/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ConsoleSessionStatusIcon } from '../../browser/components/consoleSessionStatusIcon.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

describe('ConsoleSessionStatusIcon', () => {
	const displayStateEmitter = new Emitter<{ sessionId: string; state: RuntimeState }>();
	let displayState: RuntimeState | undefined;

	const sessionsById = new Map<string, ILanguageRuntimeSession>();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IRuntimeSessionService, {
			onDidChangeDisplayRuntimeState: displayStateEmitter.event,
			getDisplayRuntimeState: () => displayState,
			getSession: (sessionId: string) => sessionsById.get(sessionId),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function makeInstance(sessionId: string | undefined, { attached = true } = {}): IPositronConsoleInstance {
		const session = sessionId
			? stubInterface<ILanguageRuntimeSession>({
				sessionId,
				getRuntimeState: () => RuntimeState.Idle,
			})
			: undefined;
		if (sessionId && session) {
			sessionsById.set(sessionId, session);
		}
		return stubInterface<IPositronConsoleInstance>({
			sessionId: sessionId ?? 'none',
			attachedRuntimeSession: attached ? session : undefined,
		});
	}

	function setDisplayState(sessionId: string, state: RuntimeState) {
		displayState = state;
		act(() => displayStateEmitter.fire({ sessionId, state }));
	}

	it('renders the disconnected icon when no session is attached', () => {
		displayState = undefined;
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance(undefined)} />);
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
	});

	it('renders the idle icon when display state is Idle', () => {
		displayState = RuntimeState.Idle;
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance('s1')} />);
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
	});

	it('shows the active icon when display state is Restarting', () => {
		displayState = RuntimeState.Idle;
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance('s1')} />);
		setDisplayState('s1', RuntimeState.Restarting);
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});

	it('switches to the active icon when display state goes Busy', () => {
		displayState = RuntimeState.Idle;
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance('s1')} />);
		setDisplayState('s1', RuntimeState.Busy);
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});

	it('stays active during a restart even after the console detaches its runtime', () => {
		// On restart the kernel exits and the console detaches, so
		// attachedRuntimeSession is undefined. The service still reports the
		// session as Restarting, so the icon must read by sessionId and stay active.
		displayState = RuntimeState.Restarting;
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance('s1', { attached: false })} />);
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});
});
