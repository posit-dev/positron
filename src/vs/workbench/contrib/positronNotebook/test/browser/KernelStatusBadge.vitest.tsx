/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

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
} from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { NotebookKernelStatus, IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { RuntimeNotebookKernel } from '../../../runtimeNotebookKernel/browser/runtimeNotebookKernel.js';
import { KernelStatusBadge } from '../../browser/KernelStatusBadge.js';
import { NotebookInstanceProvider } from '../../browser/NotebookInstanceProvider.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

const NOTEBOOK_URI = URI.file('/tmp/notebook.ipynb');

describe('KernelStatusBadge', () => {
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

	function makeKernel(runtimeName: string, runtimeId: string): RuntimeNotebookKernel {
		return stubInterface<RuntimeNotebookKernel>({
			runtime: stubInterface<ILanguageRuntimeMetadata>({ runtimeName, runtimeId }),
		});
	}

	function makeInstance(
		kernelStatus: NotebookKernelStatus,
		kernel?: RuntimeNotebookKernel,
		session?: ILanguageRuntimeSession,
	): IPositronNotebookInstance {
		return stubInterface<IPositronNotebookInstance>({
			uri: NOTEBOOK_URI,
			kernelStatus: observableValue<NotebookKernelStatus>('test-kernelStatus', kernelStatus),
			kernel: observableValue('test-kernel', kernel),
			runtimeSession: observableValue<ILanguageRuntimeSession | undefined>('test-runtimeSession', session),
			container: observableValue('test-container', undefined),
		});
	}

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ILanguageRuntimeService, {
			startupPhase: RuntimeStartupPhase.Complete,
			onDidChangeRuntimeStartupPhase: new Emitter<RuntimeStartupPhase>().event,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderBadge(instance: IPositronNotebookInstance) {
		return rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<KernelStatusBadge />
			</NotebookInstanceProvider>
		);
	}

	it('shows disconnected icon and "No Kernel Selected" when kernelStatus=Unselected and no session', () => {
		renderBadge(makeInstance(NotebookKernelStatus.Unselected));
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('No Kernel Selected')).toBeInTheDocument();
	});

	it('shows active icon and "Discovering Interpreters..." when kernelStatus=Discovering', () => {
		renderBadge(makeInstance(NotebookKernelStatus.Discovering));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('Discovering Interpreters...')).toBeInTheDocument();
	});

	it('shows active icon and new kernel name when switching kernels', () => {
		// Switching after a kernel swap: new kernel selected, no session yet.
		const newKernel = makeKernel('Python 3.12', 'python-3.12');
		renderBadge(makeInstance(NotebookKernelStatus.Switching, newKernel));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('shows active icon immediately when switching even if the old session is still Idle', () => {
		// Early in the switch the new kernel is selected and kernelStatus
		// is Switching, but the old session hasn't started exiting yet.
		// Switching must override the old session's stale Idle state so
		// the user gets immediate spinner feedback on click.
		const newKernel = makeKernel('R 4.3.2', 'r-4.3.2');
		const { session } = makeSession(RuntimeState.Idle);
		renderBadge(makeInstance(NotebookKernelStatus.Switching, newKernel, session));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('R 4.3.2')).toBeInTheDocument();
	});

	it('shows disconnected icon and kernel name when a kernel is selected but no session is attached', () => {
		const kernel = makeKernel('Python 3.12', 'python-3.12');
		renderBadge(makeInstance(NotebookKernelStatus.Unselected, kernel));
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('shows idle icon and runtime name when a session is Idle', () => {
		const { session } = makeSession(RuntimeState.Idle);
		renderBadge(makeInstance(NotebookKernelStatus.Connected, undefined, session));
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('updates display when the session emits state changes', () => {
		const { session, emitter } = makeSession(RuntimeState.Idle);
		renderBadge(makeInstance(NotebookKernelStatus.Connected, undefined, session));
		act(() => emitter.fire(RuntimeState.Restarting));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		act(() => emitter.fire(RuntimeState.Idle));
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
	});

	it('shows disconnected icon and runtime name when a kernel exits without a switch', () => {
		// Post-shutdown: session gone, kernel still selected.
		const kernel = makeKernel('Python 3.12', 'python-3.12');
		renderBadge(makeInstance(NotebookKernelStatus.Exited, kernel));
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});
});
