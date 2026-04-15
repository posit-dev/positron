/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-no-dangerous-type-assertions


import React from 'react';
import { act } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeAutoStartEvent, IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { setupRTLRenderer } from '../../../../../base/test/browser/reactTestingLibrary.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { StartupStatus } from '../../browser/components/startupStatus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLanguageRuntimeService(initialPhase: RuntimeStartupPhase = RuntimeStartupPhase.Initializing) {
	const onDidRegisterRuntime = new Emitter<ILanguageRuntimeMetadata>();
	const onDidChangeRuntimeStartupPhase = new Emitter<RuntimeStartupPhase>();
	let registeredRuntimes: ILanguageRuntimeMetadata[] = [];

	return {
		service: {
			registeredRuntimes,
			startupPhase: initialPhase,
			onDidRegisterRuntime: onDidRegisterRuntime.event,
			onDidChangeRuntimeStartupPhase: onDidChangeRuntimeStartupPhase.event,
		} as Partial<ILanguageRuntimeService>,
		onDidRegisterRuntime,
		onDidChangeRuntimeStartupPhase,
		registeredRuntimes,
	};
}

function createMockRuntimeStartupService() {
	const onWillAutoStartRuntime = new Emitter<IRuntimeAutoStartEvent>();
	return {
		service: {
			onWillAutoStartRuntime: onWillAutoStartRuntime.event,
		} as Partial<IRuntimeStartupService>,
		onWillAutoStartRuntime,
	};
}

function makeAutoStartEvent(overrides: Partial<IRuntimeAutoStartEvent> = {}): IRuntimeAutoStartEvent {
	return {
		runtime: {
			runtimeName: 'Python 3.12.1',
			base64EncodedIconSvg: 'PHN2Zz48L3N2Zz4=', // <svg></svg>
		} as ILanguageRuntimeMetadata,
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
			const { container } = rtl.render(<StartupStatus />);
			expect(container.textContent).toContain('Waiting for extensions');
		});

		it('shows "Cannot start consoles in Restricted Mode" during AwaitingTrust phase', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.AwaitingTrust);
			});

			expect(container.textContent).toContain('Cannot start consoles in Restricted Mode');
		});

		it('hides the progress bar during AwaitingTrust phase', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.AwaitingTrust);
			});

			const progressBar = container.querySelector('.progress');
			expect(progressBar).not.toBeNull();
			expect((progressBar as HTMLElement).style.display).toBe('none');
		});

		it('shows "Reconnecting" during Reconnecting phase', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Reconnecting);
			});

			expect(container.textContent).toContain('Reconnecting');
		});

		it('shows "Setting up workspace" during NewFolderTasks phase', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.NewFolderTasks);
			});

			expect(container.textContent).toContain('Setting up workspace');
		});

		it('shows "Starting" during Starting phase', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Starting);
			});

			expect(container.textContent).toContain('Starting');
		});

		it('shows "Discovering interpreters" during Discovering phase', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Discovering);
			});

			expect(container.textContent).toContain('Discovering interpreters');
		});
	});

	describe('runtime discovery counter', () => {
		const langMock = createMockLanguageRuntimeService(RuntimeStartupPhase.Discovering);
		const startupMock = createMockRuntimeStartupService();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(ILanguageRuntimeService, langMock.service)
			.stub(IRuntimeStartupService, startupMock.service)
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('shows the count of discovered interpreters', () => {
			const { container } = rtl.render(<StartupStatus />);

			// Simulate discovering 2 runtimes
			act(() => {
				langMock.registeredRuntimes.push({} as ILanguageRuntimeMetadata);
				langMock.onDidRegisterRuntime.fire({} as ILanguageRuntimeMetadata);
			});
			act(() => {
				langMock.registeredRuntimes.push({} as ILanguageRuntimeMetadata);
				langMock.onDidRegisterRuntime.fire({} as ILanguageRuntimeMetadata);
			});

			expect(container.textContent).toContain('(2)');
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
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent({
					activate: true,
					newSession: true,
				}));
			});

			expect(container.textContent).toContain('Python 3.12.1');
			expect(container.textContent).toContain('Preparing');
		});

		it('shows "Reconnecting" for existing session auto-start', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent({
					activate: true,
					newSession: false,
				}));
			});

			expect(container.textContent).toContain('Python 3.12.1');
			expect(container.textContent).toContain('Reconnecting');
		});

		it('ignores auto-start events with activate=false', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent({
					activate: false,
				}));
			});

			// Should still show the phase text, not the runtime name
			expect(container.textContent).not.toContain('Python 3.12.1');
			expect(container.textContent).toContain('Starting');
		});

		it('suppresses phase text when auto-start event is active', () => {
			const { container } = rtl.render(<StartupStatus />);

			// Initially shows "Starting..."
			expect(container.textContent).toContain('Starting');

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent());
			});

			// "Starting" text should be suppressed, replaced by runtime progress
			expect(container.textContent).toContain('Python 3.12.1');
			// The phase-specific text ("Starting...") is hidden when runtimeStartupEvent is set
			expect(container.querySelector('.starting')).toBeNull();
		});
	});
});
