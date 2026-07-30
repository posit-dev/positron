/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeStartupPhase, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { EditorGroupContext } from '../../../../browser/parts/editor/editorGroupContext.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IQuartoKernelManager, QuartoKernelState, QuartoKernelStateChangeEvent } from '../../browser/quartoKernelManager.js';
import { QuartoKernelStatusBadge } from '../../browser/QuartoKernelStatusBadge.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

describe('QuartoKernelStatusBadge', () => {
	const stateChange = new Emitter<QuartoKernelStateChangeEvent>();
	const displayStateEmitter = new Emitter<{ sessionId: string; state: RuntimeState }>();
	const registerRuntimeEmitter = new Emitter<ILanguageRuntimeMetadata>();
	const startupPhaseEmitter = new Emitter<RuntimeStartupPhase>();
	let displayState: RuntimeState | undefined;

	const quartoUri = URI.file('/tmp/notebook.qmd');

	// The badge binds to its own editor group, not the globally active editor
	// (posit-dev/positron#14826). Rendering inside this group -- whose active
	// editor is the .qmd -- is what drives the badge; the ambient IEditorService
	// deliberately has no Quarto editor active, so a regression to reading the
	// global active editor would surface as "No Kernel" and fail these tests.
	const editorGroupStub = stubInterface<IEditorGroup>({
		activeEditor: stubInterface<EditorInput>({ resource: quartoUri }),
		activeEditorPane: undefined,
		onDidActiveEditorChange: Event.None,
	});

	const kernelManagerStub = {
		onDidChangeKernelState: stateChange.event,
		getKernelState: () => QuartoKernelState.None as QuartoKernelState,
		getSessionForDocument: () => undefined as ILanguageRuntimeSession | undefined,
		getPreferredRuntimeForDocument: () => undefined as ILanguageRuntimeMetadata | undefined,
	};

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IQuartoKernelManager, kernelManagerStub)
		.stub(IRuntimeSessionService, {
			onDidChangeDisplayRuntimeState: displayStateEmitter.event,
			getDisplayRuntimeState: () => displayState,
		})
		.stub(ILanguageRuntimeService, {
			onDidRegisterRuntime: registerRuntimeEmitter.event,
			onDidChangeRuntimeStartupPhase: startupPhaseEmitter.event,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// Render the badge inside its editor group, the way the action bar does.
	const renderBadge = () => rtl.render(
		<EditorGroupContext.Provider value={editorGroupStub}>
			<QuartoKernelStatusBadge accessor={ctx.instantiationService} />
		</EditorGroupContext.Provider>
	);

	function makeSession(initial: RuntimeState, sessionId = 's1') {
		const emitter = new Emitter<RuntimeState>();
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId,
			getRuntimeState: () => initial,
			onDidChangeRuntimeState: emitter.event,
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' }),
		});
		return { session, emitter };
	}

	beforeEach(() => {
		displayState = undefined;
		kernelManagerStub.getKernelState = () => QuartoKernelState.None;
		kernelManagerStub.getSessionForDocument = () => undefined;
		kernelManagerStub.getPreferredRuntimeForDocument = () => undefined;
	});

	it('shows disconnected icon and "No Kernel" label when no session, no preferred runtime, and state is None', () => {
		renderBadge();
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('No Kernel')).toBeInTheDocument();
	});

	it('names the interpreter that would start when no kernel is running', () => {
		// No session yet, but a preferred runtime is available: the badge should
		// name it instead of showing "No Kernel".
		kernelManagerStub.getPreferredRuntimeForDocument = () =>
			stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' });
		renderBadge();
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('names a preferred runtime discovered after the initial render', () => {
		// Interpreter discovery can finish after the editor opens: the badge
		// starts with "No Kernel" and should adopt the interpreter name once a
		// preferred runtime becomes available and a registration event fires.
		renderBadge();
		expect(screen.getByText('No Kernel')).toBeInTheDocument();

		kernelManagerStub.getPreferredRuntimeForDocument = () =>
			stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' });
		act(() => registerRuntimeEmitter.fire(
			stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' })));

		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('recomputes the preferred runtime when the startup phase changes', () => {
		// The preferred runtime can resolve as the runtime startup sequence
		// advances, so a startup-phase change should also refresh the label.
		renderBadge();
		expect(screen.getByText('No Kernel')).toBeInTheDocument();

		kernelManagerStub.getPreferredRuntimeForDocument = () =>
			stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' });
		act(() => startupPhaseEmitter.fire(RuntimeStartupPhase.Complete));

		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('shows the state label over the preferred runtime when not in the None state', () => {
		// An Error state should still surface the error label rather than the
		// prospective interpreter name.
		kernelManagerStub.getKernelState = () => QuartoKernelState.Error;
		kernelManagerStub.getPreferredRuntimeForDocument = () =>
			stubInterface<ILanguageRuntimeMetadata>({ runtimeName: 'Python 3.12' });
		renderBadge();
		expect(screen.getByText('Kernel Error')).toBeInTheDocument();
	});

	it('shows disconnected icon when manager reports an Error state', () => {
		kernelManagerStub.getKernelState = () => QuartoKernelState.Error;
		renderBadge();
		expect(screen.getByTestId('runtime-status-disconnected')).toBeInTheDocument();
		expect(screen.getByText('Kernel Error')).toBeInTheDocument();
	});

	it('shows idle icon and runtime name when a session is Idle', () => {
		const { session } = makeSession(RuntimeState.Idle);
		kernelManagerStub.getSessionForDocument = () => session;
		kernelManagerStub.getKernelState = () => QuartoKernelState.Ready;
		displayState = RuntimeState.Idle;
		renderBadge();
		expect(screen.getByTestId('runtime-status-idle')).toBeInTheDocument();
		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
	});

	it('updates display when the display state emitter fires a state change', () => {
		const { session } = makeSession(RuntimeState.Idle);
		kernelManagerStub.getSessionForDocument = () => session;
		kernelManagerStub.getKernelState = () => QuartoKernelState.Ready;
		displayState = RuntimeState.Idle;
		renderBadge();
		act(() => displayStateEmitter.fire({ sessionId: 's1', state: RuntimeState.Busy }));
		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});

	it('reflects the new session runtime state when manager swaps the session', () => {
		const a = makeSession(RuntimeState.Idle, 'sA');
		kernelManagerStub.getSessionForDocument = () => a.session;
		kernelManagerStub.getKernelState = () => QuartoKernelState.Ready;
		displayState = RuntimeState.Idle;
		renderBadge();

		const b = makeSession(RuntimeState.Starting, 'sB');
		displayState = RuntimeState.Starting;
		act(() => stateChange.fire({
			documentUri: quartoUri,
			oldState: QuartoKernelState.Ready,
			newState: QuartoKernelState.Starting,
			session: b.session,
		}));

		expect(screen.getByTestId('runtime-status-active')).toBeInTheDocument();
	});

	it('keeps its running kernel visible when another editor is globally active (#14826)', () => {
		// The Settings dialog opens in a modal overlay that becomes the globally
		// active editor. Previously the badge read the global active editor, so a
		// running .qmd kernel reset to "No Kernel" while the modal was in front and
		// recovered on dismiss. The badge now reads its own group (the .qmd, with a
		// live session), so its kernel stays visible regardless of what is globally
		// active -- represented here by the container's ambient IEditorService,
		// which has no Quarto editor active.
		const { session } = makeSession(RuntimeState.Idle);
		kernelManagerStub.getSessionForDocument = () => session;
		kernelManagerStub.getKernelState = () => QuartoKernelState.Ready;
		displayState = RuntimeState.Idle;
		renderBadge();

		expect(screen.getByText('Python 3.12')).toBeInTheDocument();
		expect(screen.queryByText('No Kernel')).not.toBeInTheDocument();
	});
});
