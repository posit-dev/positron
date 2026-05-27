/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IQuartoKernelManager, QuartoKernelState, QuartoKernelStateChangeEvent } from '../../browser/quartoKernelManager.js';
import { QuartoKernelStatusBadge } from '../../browser/QuartoKernelStatusBadge.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

describe('QuartoKernelStatusBadge', () => {
	const stateChange = new Emitter<QuartoKernelStateChangeEvent>();
	const editorChange = new Emitter<void>();

	// Use mutable stub objects so individual tests can override specific methods
	// without triggering Proxy-set semantics on the stubInterface result.
	const editorServiceStub = {
		activeEditor: { resource: URI.file('/tmp/notebook.qmd') },
		activeTextEditorControl: undefined as unknown,
		onDidActiveEditorChange: editorChange.event,
	};

	const kernelManagerStub = {
		onDidChangeKernelState: stateChange.event,
		getKernelState: () => QuartoKernelState.None as QuartoKernelState,
		getSessionForDocument: () => undefined as ILanguageRuntimeSession | undefined,
	};

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IEditorService, editorServiceStub)
		.stub(IQuartoKernelManager, kernelManagerStub)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function makeSession(initial: RuntimeState) {
		const emitter = new Emitter<RuntimeState>();
		const session = stubInterface<ILanguageRuntimeSession>({
			getRuntimeState: () => initial,
			onDidChangeRuntimeState: emitter.event,
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' }),
		});
		return { session, emitter };
	}

	beforeEach(() => {
		// Reset stubs to defaults before each test
		editorServiceStub.activeEditor = { resource: URI.file('/tmp/notebook.qmd') };
		kernelManagerStub.getKernelState = () => QuartoKernelState.None;
		kernelManagerStub.getSessionForDocument = () => undefined;
	});

	it('shows disconnected icon and "No Kernel" label when no session and state is None', () => {
		rtl.render(<QuartoKernelStatusBadge accessor={ctx.instantiationService} />);
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('No Kernel')).toBeInTheDocument();
	});

	it('shows disconnected icon when manager reports an Error state', () => {
		kernelManagerStub.getKernelState = () => QuartoKernelState.Error;
		rtl.render(<QuartoKernelStatusBadge accessor={ctx.instantiationService} />);
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Kernel Error')).toBeInTheDocument();
	});

	it('shows idle icon and runtime name when a session is Idle', () => {
		const { session } = makeSession(RuntimeState.Idle);
		kernelManagerStub.getSessionForDocument = () => session;
		kernelManagerStub.getKernelState = () => QuartoKernelState.Ready;
		rtl.render(<QuartoKernelStatusBadge accessor={ctx.instantiationService} />);
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('updates display when the session emits a state change', () => {
		const { session, emitter } = makeSession(RuntimeState.Idle);
		kernelManagerStub.getSessionForDocument = () => session;
		kernelManagerStub.getKernelState = () => QuartoKernelState.Ready;
		rtl.render(<QuartoKernelStatusBadge accessor={ctx.instantiationService} />);
		act(() => emitter.fire(RuntimeState.Busy));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});

	it('reflects the new session runtime state when manager swaps the session', () => {
		const a = makeSession(RuntimeState.Idle);
		kernelManagerStub.getSessionForDocument = () => a.session;
		kernelManagerStub.getKernelState = () => QuartoKernelState.Ready;
		rtl.render(<QuartoKernelStatusBadge accessor={ctx.instantiationService} />);

		const b = makeSession(RuntimeState.Starting);
		act(() => stateChange.fire({
			documentUri: URI.file('/tmp/notebook.qmd'),
			oldState: QuartoKernelState.Ready,
			newState: QuartoKernelState.Starting,
			session: b.session,
		}));

		// Display follows session B, not session A
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});
});
