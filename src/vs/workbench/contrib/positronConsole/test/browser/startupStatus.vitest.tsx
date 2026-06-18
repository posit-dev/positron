/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeAutoStartEvent, IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { StartupStatus } from '../../browser/components/startupStatus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Emitters must be created at describe level (or in helpers called at describe level),
// not inside it() -- see the `Common mistake:` callout in .claude/rules/vitest-tests.md.
function createMockLanguageRuntimeService(initialPhase: RuntimeStartupPhase = RuntimeStartupPhase.Initializing) {
	const onDidRegisterRuntime = new Emitter<ILanguageRuntimeMetadata>();
	const onDidChangeRuntimeStartupPhase = new Emitter<RuntimeStartupPhase>();
	const registeredRuntimes: ILanguageRuntimeMetadata[] = [];

	return {
		service: {
			registeredRuntimes,
			startupPhase: initialPhase,
			onDidRegisterRuntime: onDidRegisterRuntime.event,
			onDidChangeRuntimeStartupPhase: onDidChangeRuntimeStartupPhase.event,
		},
		onDidRegisterRuntime,
		onDidChangeRuntimeStartupPhase,
		registeredRuntimes,
	};
}

function createMockRuntimeStartupService(lastDiscoveryRuntimeCount = 0) {
	const onWillAutoStartRuntime = new Emitter<IRuntimeAutoStartEvent>();
	return {
		service: {
			onWillAutoStartRuntime: onWillAutoStartRuntime.event,
			lastDiscoveryRuntimeCount,
		},
		onWillAutoStartRuntime,
	};
}

function makeAutoStartEvent(overrides: Partial<IRuntimeAutoStartEvent> = {}): IRuntimeAutoStartEvent {
	const runtime = stubInterface<ILanguageRuntimeMetadata>({
		runtimeName: 'Python 3.12.1',
		base64EncodedIconSvg: 'PHN2Zz48L3N2Zz4=', // <svg></svg>
	});
	return {
		runtime,
		newSession: true,
		activate: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartupStatus', () => {

	describe('startup phases', () => {
		const langMock = createMockLanguageRuntimeService(RuntimeStartupPhase.Initializing);
		const startupMock = createMockRuntimeStartupService();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(ILanguageRuntimeService, langMock.service)
			.stub(IRuntimeStartupService, startupMock.service)
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('shows "Waiting for extensions" during Initializing phase', () => {
			rtl.render(<StartupStatus />);
			expect(screen.getByText(/Waiting for extensions/)).toBeInTheDocument();
		});

		it('shows "Cannot start consoles in Restricted Mode" during AwaitingTrust phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.AwaitingTrust);
			});

			expect(screen.getByText(/Cannot start consoles in Restricted Mode/)).toBeInTheDocument();
		});

		it('hides the progress bar during AwaitingTrust phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.AwaitingTrust);
			});

			// Confirm we're in AwaitingTrust state via the user-facing message.
			expect(screen.getByText(/Cannot start consoles in Restricted Mode/)).toBeInTheDocument();
			const progressBar = screen.getByTestId('startup-progress-bar');
			expect(progressBar).toHaveStyle({ display: 'none' });
		});

		it('shows "Reconnecting" during Reconnecting phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Reconnecting);
			});

			expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
		});

		it('shows "Setting up workspace" during NewFolderTasks phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.NewFolderTasks);
			});

			expect(screen.getByText(/Setting up workspace/)).toBeInTheDocument();
		});

		it('shows "Starting" during Starting phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Starting);
			});

			expect(screen.getByText(/Starting/)).toBeInTheDocument();
		});

		it('shows "Discovering interpreters" during Discovering phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Discovering);
			});

			expect(screen.getByText(/Discovering interpreters/)).toBeInTheDocument();
		});
	});

	describe('runtime discovery progress', () => {
		const langMock = createMockLanguageRuntimeService(RuntimeStartupPhase.Discovering);
		const startupMock = createMockRuntimeStartupService(/* lastDiscoveryRuntimeCount */ 4);
		const ctx = createTestContainer()
			.withReactServices()
			.stub(ILanguageRuntimeService, langMock.service)
			.stub(IRuntimeStartupService, startupMock.service)
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('does not render an interpreter count', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				const runtime = stubInterface<ILanguageRuntimeMetadata>({ runtimePath: '/usr/bin/python' });
				langMock.registeredRuntimes.push(runtime);
				langMock.onDidRegisterRuntime.fire(runtime);
			});

			expect(screen.getByText(/Discovering interpreters/)).not.toHaveTextContent(/\(\d+\)/);
		});

		it('shows the path of the most recently discovered interpreter', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				const runtime = stubInterface<ILanguageRuntimeMetadata>({ runtimePath: '/opt/local/python' });
				langMock.registeredRuntimes.push(runtime);
				langMock.onDidRegisterRuntime.fire(runtime);
			});

			expect(screen.getByText('/opt/local/python')).toBeInTheDocument();
		});

		it('drives a determinate progress bar from the prior discovery count', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				const runtime = stubInterface<ILanguageRuntimeMetadata>({ runtimePath: '/usr/bin/python' });
				langMock.registeredRuntimes.push(runtime);
				langMock.onDidRegisterRuntime.fire(runtime);
			});

			// ProgressBar is annotated by role; .discrete is set when total/worked
			// are wired up.
			const progressBar = screen.getByRole('progressbar');
			expect(progressBar).toHaveClass('discrete');
		});
	});

	describe('runtime discovery progress without prior data', () => {
		const langMock = createMockLanguageRuntimeService(RuntimeStartupPhase.Discovering);
		const startupMock = createMockRuntimeStartupService(/* lastDiscoveryRuntimeCount */ 0);
		const ctx = createTestContainer()
			.withReactServices()
			.stub(ILanguageRuntimeService, langMock.service)
			.stub(IRuntimeStartupService, startupMock.service)
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('falls back to an infinite progress bar', () => {
			rtl.render(<StartupStatus />);

			const progressBar = screen.getByRole('progressbar');
			expect(progressBar).toHaveClass('infinite');
		});
	});

	describe('auto-start events', () => {
		const langMock = createMockLanguageRuntimeService(RuntimeStartupPhase.Starting);
		const startupMock = createMockRuntimeStartupService();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(ILanguageRuntimeService, langMock.service)
			.stub(IRuntimeStartupService, startupMock.service)
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('shows runtime name when auto-start event fires with activate=true', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent({
					activate: true,
					newSession: true,
				}));
			});

			expect(screen.getByText('Python 3.12.1')).toBeInTheDocument();
			expect(screen.getByText('Preparing')).toBeInTheDocument();
		});

		it('shows "Reconnecting" for existing session auto-start', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent({
					activate: true,
					newSession: false,
				}));
			});

			expect(screen.getByText('Python 3.12.1')).toBeInTheDocument();
			expect(screen.getByText('Reconnecting')).toBeInTheDocument();
		});

		it('ignores auto-start events with activate=false', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent({
					activate: false,
				}));
			});

			// Should still show the phase text, not the runtime name.
			expect(screen.queryByText('Python 3.12.1')).not.toBeInTheDocument();
			expect(screen.getByText(/Starting/)).toBeInTheDocument();
		});

		it('suppresses phase text when auto-start event is active', () => {
			rtl.render(<StartupStatus />);

			// Initially shows "Starting..."
			expect(screen.getByText(/Starting/)).toBeInTheDocument();

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent());
			});

			// "Starting" text should be suppressed, replaced by runtime progress.
			expect(screen.getByText('Python 3.12.1')).toBeInTheDocument();
			// The phase-specific text ("Starting...") is hidden when runtimeStartupEvent
			// is set; the .starting div is no longer rendered.
			expect(screen.queryByText(/^Starting/)).not.toBeInTheDocument();
		});
	});
});
