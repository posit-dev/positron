/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { useSessionRuntimeState } from '../../browser/components/useSessionRuntimeState.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

interface ProbeProps {
	session: ILanguageRuntimeSession | undefined;
}

const TestComponent = ({ session }: ProbeProps) => {
	const state = useSessionRuntimeState(session);
	return <div data-testid={'state'}>{state ?? 'none'}</div>;
};

describe('useSessionRuntimeState', () => {
	const displayStateEmitter = new Emitter<{ sessionId: string; state: RuntimeState }>();
	let displayState: RuntimeState | undefined;

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IRuntimeSessionService, {
			onDidChangeDisplayRuntimeState: displayStateEmitter.event,
			getDisplayRuntimeState: () => displayState,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function makeSession(sessionId: string, initial: RuntimeState) {
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId,
			getRuntimeState: () => initial,
		});
		return session;
	}

	it('returns undefined when session is undefined', () => {
		displayState = undefined;
		rtl.render(<TestComponent session={undefined} />);
		expect(screen.getByTestId('state')).toHaveTextContent('none');
	});

	it('returns the initial runtime state for a session', () => {
		displayState = RuntimeState.Idle;
		const session = makeSession('s1', RuntimeState.Idle);
		rtl.render(<TestComponent session={session} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Idle);
	});

	it('updates when the session emits a state change', () => {
		displayState = RuntimeState.Idle;
		const session = makeSession('s1', RuntimeState.Idle);
		rtl.render(<TestComponent session={session} />);
		act(() => {
			displayState = RuntimeState.Busy;
			displayStateEmitter.fire({ sessionId: 's1', state: RuntimeState.Busy });
		});
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Busy);
	});

	it('switches subscription when the session prop changes', () => {
		displayState = RuntimeState.Idle;
		const sessionA = makeSession('s1', RuntimeState.Idle);
		const sessionB = makeSession('s2', RuntimeState.Starting);
		const { rerender } = rtl.render(<TestComponent session={sessionA} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Idle);
		act(() => {
			displayState = RuntimeState.Starting;
		});
		rerender(<TestComponent session={sessionB} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Starting);
		act(() => {
			displayStateEmitter.fire({ sessionId: 's1', state: RuntimeState.Busy });
		});
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Starting);
	});

	it('clears state when session becomes undefined', () => {
		displayState = RuntimeState.Idle;
		const session = makeSession('s1', RuntimeState.Idle);
		const { rerender } = rtl.render(<TestComponent session={session} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Idle);
		rerender(<TestComponent session={undefined} />);
		expect(screen.getByTestId('state')).toHaveTextContent('none');
		act(() => {
			displayStateEmitter.fire({ sessionId: 's1', state: RuntimeState.Busy });
		});
		expect(screen.getByTestId('state')).toHaveTextContent('none');
	});
});
