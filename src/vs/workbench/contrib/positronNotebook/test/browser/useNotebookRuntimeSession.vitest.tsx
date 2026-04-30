/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILanguageRuntimeExit } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import {
	ILanguageRuntimeSession,
	IRuntimeSessionService,
	IRuntimeSessionWillStartEvent,
	IRuntimeSessionMetadata,
	RuntimeStartMode,
} from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { useNotebookRuntimeSession } from '../../browser/useNotebookRuntimeSession.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

const NOTEBOOK_URI = URI.file('/tmp/notebook.ipynb');
const OTHER_URI = URI.file('/tmp/other.ipynb');

interface ProbeProps {
	uri: URI;
}

const Probe = ({ uri }: ProbeProps) => {
	const session = useNotebookRuntimeSession(uri);
	return <div data-testid={'session'}>{session ? session.metadata.sessionId : 'none'}</div>;
};

describe('useNotebookRuntimeSession', () => {
	const onWillStartSession = new Emitter<IRuntimeSessionWillStartEvent>();
	let currentSession: ILanguageRuntimeSession | undefined;

	function makeSession(sessionId: string, notebookUri: URI): ILanguageRuntimeSession {
		const onDidEndSession = new Emitter<ILanguageRuntimeExit>();
		return stubInterface<ILanguageRuntimeSession>({
			metadata: stubInterface<IRuntimeSessionMetadata>({ sessionId, notebookUri }),
			onDidEndSession: onDidEndSession.event,
		});
	}

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IRuntimeSessionService, {
			onWillStartSession: onWillStartSession.event,
			getNotebookSessionForNotebookUri: (uri: URI) =>
				currentSession && uri.toString() === NOTEBOOK_URI.toString()
					? currentSession
					: undefined,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		currentSession = undefined;
	});

	it('returns undefined when no session exists for the URI', () => {
		rtl.render(<Probe uri={NOTEBOOK_URI} />);
		expect(screen.getByTestId('session')).toHaveTextContent('none');
	});

	it('returns the existing session if one is already attached', () => {
		currentSession = makeSession('s1', NOTEBOOK_URI);
		rtl.render(<Probe uri={NOTEBOOK_URI} />);
		expect(screen.getByTestId('session')).toHaveTextContent('s1');
	});

	it('updates when a session starts for the URI', () => {
		rtl.render(<Probe uri={NOTEBOOK_URI} />);
		expect(screen.getByTestId('session')).toHaveTextContent('none');
		const session = makeSession('s1', NOTEBOOK_URI);
		currentSession = session;
		act(() => onWillStartSession.fire({
			startMode: RuntimeStartMode.Starting,
			activate: true,
			hasConsole: false,
			session,
		}));
		expect(screen.getByTestId('session')).toHaveTextContent('s1');
	});

	it('ignores session-start events for a different notebook URI', () => {
		rtl.render(<Probe uri={NOTEBOOK_URI} />);
		const otherSession = makeSession('s-other', OTHER_URI);
		act(() => onWillStartSession.fire({
			startMode: RuntimeStartMode.Starting,
			activate: true,
			hasConsole: false,
			session: otherSession,
		}));
		expect(screen.getByTestId('session')).toHaveTextContent('none');
	});

	it('clears when the attached session ends', () => {
		const onDidEndSession = new Emitter<ILanguageRuntimeExit>();
		const session = stubInterface<ILanguageRuntimeSession>({
			metadata: stubInterface<IRuntimeSessionMetadata>({ sessionId: 's1', notebookUri: NOTEBOOK_URI }),
			onDidEndSession: onDidEndSession.event,
		});
		currentSession = session;
		rtl.render(<Probe uri={NOTEBOOK_URI} />);
		expect(screen.getByTestId('session')).toHaveTextContent('s1');
		currentSession = undefined;
		act(() => onDidEndSession.fire(stubInterface<ILanguageRuntimeExit>()));
		expect(screen.getByTestId('session')).toHaveTextContent('none');
	});
});
