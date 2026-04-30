/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ConsoleSessionStatusIcon } from '../../browser/components/consoleSessionStatusIcon.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

describe('ConsoleSessionStatusIcon', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function makeSession(initial: RuntimeState) {
		const emitter = new Emitter<RuntimeState>();
		const session = stubInterface<ILanguageRuntimeSession>({
			getRuntimeState: () => initial,
			onDidChangeRuntimeState: emitter.event,
		});
		return { session, emitter };
	}

	function makeInstance(session: ILanguageRuntimeSession | undefined): IPositronConsoleInstance {
		return stubInterface<IPositronConsoleInstance>({
			attachedRuntimeSession: session,
		});
	}

	it('renders the disconnected icon when no session is attached', () => {
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance(undefined)} />);
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
	});

	it('renders the idle icon when the session is Idle', () => {
		const { session } = makeSession(RuntimeState.Idle);
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance(session)} />);
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
	});

	it('switches to the active icon when the session goes Busy', () => {
		const { session, emitter } = makeSession(RuntimeState.Idle);
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance(session)} />);
		act(() => emitter.fire(RuntimeState.Busy));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});

	it('shows active icon during Restarting (regression: previously showed stale state via PositronConsoleState)', () => {
		const { session, emitter } = makeSession(RuntimeState.Idle);
		rtl.render(<ConsoleSessionStatusIcon positronConsoleInstance={makeInstance(session)} />);
		act(() => emitter.fire(RuntimeState.Restarting));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});
});
