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
	IRuntimeSessionService,
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
	const displayStateEmitter = new Emitter<{ sessionId: string; state: RuntimeState }>();
	let displayState: RuntimeState | undefined;

	function makeSession(initial: RuntimeState, sessionId = 's1'): { session: ILanguageRuntimeSession; emitter: Emitter<RuntimeState> } {
		const stateEmitter = new Emitter<RuntimeState>();
		const endEmitter = new Emitter<ILanguageRuntimeExit>();
		return {
			session: stubInterface<ILanguageRuntimeSession>({
				sessionId,
				metadata: stubInterface<IRuntimeSessionMetadata>({ sessionId, notebookUri: NOTEBOOK_URI }),
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
		.stub(IRuntimeSessionService, {
			onDidChangeDisplayRuntimeState: displayStateEmitter.event,
			getDisplayRuntimeState: () => displayState,
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
		displayState = undefined;
		renderBadge(makeInstance(NotebookKernelStatus.Unselected));
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('No Kernel Selected')).toBeInTheDocument();
	});

	it('shows active icon and "Discovering Interpreters..." when kernelStatus=Discovering', () => {
		displayState = undefined;
		renderBadge(makeInstance(NotebookKernelStatus.Discovering));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('Discovering Interpreters...')).toBeInTheDocument();
	});

	it('shows active icon and new kernel name when switching kernels', () => {
		displayState = undefined;
		const newKernel = makeKernel('Python 3.12', 'python-3.12');
		renderBadge(makeInstance(NotebookKernelStatus.Switching, newKernel));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('shows active icon immediately when switching even if the old session is still Idle', () => {
		displayState = RuntimeState.Idle;
		const newKernel = makeKernel('R 4.3.2', 'r-4.3.2');
		const { session } = makeSession(RuntimeState.Idle);
		renderBadge(makeInstance(NotebookKernelStatus.Switching, newKernel, session));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		expect(screen.getByText('R 4.3.2')).toBeInTheDocument();
	});

	it('shows disconnected icon and kernel name when a kernel is selected but no session is attached', () => {
		displayState = undefined;
		const kernel = makeKernel('Python 3.12', 'python-3.12');
		renderBadge(makeInstance(NotebookKernelStatus.Unselected, kernel));
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('shows idle icon and runtime name when a session is Idle', () => {
		displayState = RuntimeState.Idle;
		const { session } = makeSession(RuntimeState.Idle);
		renderBadge(makeInstance(NotebookKernelStatus.Connected, undefined, session));
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('updates display when the display state emitter fires state changes', () => {
		displayState = RuntimeState.Idle;
		const { session } = makeSession(RuntimeState.Idle);
		renderBadge(makeInstance(NotebookKernelStatus.Connected, undefined, session));
		act(() => displayStateEmitter.fire({ sessionId: 's1', state: RuntimeState.Restarting }));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
		act(() => displayStateEmitter.fire({ sessionId: 's1', state: RuntimeState.Idle }));
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
	});

	it('shows disconnected icon and runtime name when a kernel exits without a switch', () => {
		displayState = undefined;
		const kernel = makeKernel('Python 3.12', 'python-3.12');
		renderBadge(makeInstance(NotebookKernelStatus.Exited, kernel));
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});
});
