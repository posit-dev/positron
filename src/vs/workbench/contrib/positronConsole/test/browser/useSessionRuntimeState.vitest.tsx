/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
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

	it('returns undefined when session is undefined', () => {
		rtl.render(<TestComponent session={undefined} />);
		expect(screen.getByTestId('state')).toHaveTextContent('none');
	});

	it('returns the initial runtime state for a session', () => {
		const { session } = makeSession(RuntimeState.Idle);
		rtl.render(<TestComponent session={session} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Idle);
	});

	it('updates when the session emits a state change', () => {
		const { session, emitter } = makeSession(RuntimeState.Idle);
		rtl.render(<TestComponent session={session} />);
		act(() => emitter.fire(RuntimeState.Busy));
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Busy);
	});

	it('switches subscription when the session prop changes', () => {
		const a = makeSession(RuntimeState.Idle);
		const b = makeSession(RuntimeState.Starting);
		const { rerender } = rtl.render(<TestComponent session={a.session} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Idle);
		rerender(<TestComponent session={b.session} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Starting);
		// Old session changes should no longer affect the rendered state.
		act(() => a.emitter.fire(RuntimeState.Busy));
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Starting);
	});

	it('clears state when session becomes undefined', () => {
		const { session, emitter } = makeSession(RuntimeState.Idle);
		const { rerender } = rtl.render(<TestComponent session={session} />);
		expect(screen.getByTestId('state')).toHaveTextContent(RuntimeState.Idle);
		rerender(<TestComponent session={undefined} />);
		expect(screen.getByTestId('state')).toHaveTextContent('none');
		// Late events from the dropped session must not leak.
		act(() => emitter.fire(RuntimeState.Busy));
		expect(screen.getByTestId('state')).toHaveTextContent('none');
	});
});
