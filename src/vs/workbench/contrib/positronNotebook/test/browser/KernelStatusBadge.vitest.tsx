/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';
import { observableValue } from '../../../../../base/common/observable.js';
import {
	ILanguageRuntimeExit,
	ILanguageRuntimeMetadata,
	ILanguageRuntimeService,
	RuntimeStartupPhase,
	RuntimeState,
} from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import {
	ILanguageRuntimeSession,
	IRuntimeSessionMetadata,
	IRuntimeSessionService,
	IRuntimeSessionWillStartEvent,
} from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { KernelStatus, IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { KernelStatusBadge } from '../../browser/KernelStatusBadge.js';
import { NotebookInstanceProvider } from '../../browser/NotebookInstanceProvider.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

const NOTEBOOK_URI = URI.file('/tmp/notebook.ipynb');

describe('KernelStatusBadge', () => {
	const onWillStartSession = new Emitter<IRuntimeSessionWillStartEvent>();
	let currentSession: ILanguageRuntimeSession | undefined;

	function makeSession(initial: RuntimeState): { session: ILanguageRuntimeSession; emitter: Emitter<RuntimeState> } {
		const stateEmitter = new Emitter<RuntimeState>();
		const endEmitter = new Emitter<ILanguageRuntimeExit>();
		return {
			session: stubInterface<ILanguageRuntimeSession>({
				metadata: stubInterface<IRuntimeSessionMetadata>({ sessionId: 's1', notebookUri: NOTEBOOK_URI }),
				getRuntimeState: () => initial,
				onDidChangeRuntimeState: stateEmitter.event,
				onDidEndSession: endEmitter.event,
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' }),
			}),
			emitter: stateEmitter,
		};
	}

	function makeInstance(kernelStatus: KernelStatus | undefined): IPositronNotebookInstance {
		const kernelStatusObs = observableValue<KernelStatus | undefined>('test-kernelStatus', kernelStatus);
		return stubInterface<IPositronNotebookInstance>({
			uri: NOTEBOOK_URI,
			kernelStatus: kernelStatusObs,
			kernel: observableValue('test-kernel', undefined),
			container: observableValue('test-container', undefined),
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
		.stub(ILanguageRuntimeService, {
			startupPhase: RuntimeStartupPhase.Complete,
			onDidChangeRuntimeStartupPhase: new Emitter<RuntimeStartupPhase>().event,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => { currentSession = undefined; });

	function renderBadge(instance: IPositronNotebookInstance) {
		return rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<KernelStatusBadge />
			</NotebookInstanceProvider>
		);
	}

	it('shows disconnected icon and "No Kernel Selected" when kernelStatus=Unselected and no session', () => {
		renderBadge(makeInstance(KernelStatus.Unselected));
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('No Kernel Selected')).toBeInTheDocument();
	});

	it('shows active icon and "Discovering Interpreters..." when kernelStatus=Discovering', () => {
		renderBadge(makeInstance(KernelStatus.Discovering));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('Discovering Interpreters...')).toBeInTheDocument();
	});

	it('shows active icon when kernelStatus=Switching', () => {
		renderBadge(makeInstance(KernelStatus.Switching));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('Switching Kernels...')).toBeInTheDocument();
	});

	it('shows idle icon and runtime name when a session is Idle', () => {
		const { session } = makeSession(RuntimeState.Idle);
		currentSession = session;
		renderBadge(makeInstance(undefined));
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('updates display when the session emits state changes', () => {
		const { session, emitter } = makeSession(RuntimeState.Idle);
		currentSession = session;
		renderBadge(makeInstance(undefined));
		act(() => emitter.fire(RuntimeState.Restarting));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		act(() => emitter.fire(RuntimeState.Idle));
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
	});

	it('shows disconnected icon and runtime name when a kernel exits without a switch', () => {
		const { session } = makeSession(RuntimeState.Idle);
		currentSession = session;
		// Simulate the post-end-session model state: session is gone (currentSession = undefined),
		// but the kernel selection persists and kernelStatus has been set to Exited.
		currentSession = undefined;
		const instance = makeInstance(KernelStatus.Exited);
		renderBadge(instance);
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Kernel Exited')).toBeInTheDocument();
	});
});
