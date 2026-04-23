/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */


import React from 'react';
import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../base/common/event.js';
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
	let registeredRuntimes: ILanguageRuntimeMetadata[] = [];

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

function createMockRuntimeStartupService() {
	const onWillAutoStartRuntime = new Emitter<IRuntimeAutoStartEvent>();
	return {
		service: {
			onWillAutoStartRuntime: onWillAutoStartRuntime.event,
		},
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
			// getByText throws if the node isn't found, so the call itself acts as the assertion.
			rtl.render(<StartupStatus />);
			screen.getByText(/Waiting for extensions/);
		});

		it('shows "Cannot start consoles in Restricted Mode" during AwaitingTrust phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.AwaitingTrust);
			});

			screen.getByText(/Cannot start consoles in Restricted Mode/);
		});

		it('hides the progress bar during AwaitingTrust phase', () => {
			const { container } = rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.AwaitingTrust);
			});

			// Confirm we're in AwaitingTrust state via the user-facing message.
			screen.getByText(/Cannot start consoles in Restricted Mode/);
			// The progress bar div has no role/text/testid handle; querySelector on
			// the structural .progress class is the cleanest fallback for asserting
			// presence + inline display style.
			const progressBar = container.querySelector<HTMLElement>('.progress');
			expect(progressBar).toBeInTheDocument();
			expect(progressBar!.style.display).toBe('none');
		});

		it('shows "Reconnecting" during Reconnecting phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Reconnecting);
			});

			screen.getByText(/Reconnecting/);
		});

		it('shows "Setting up workspace" during NewFolderTasks phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.NewFolderTasks);
			});

			screen.getByText(/Setting up workspace/);
		});

		it('shows "Starting" during Starting phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Starting);
			});

			screen.getByText(/Starting/);
		});

		it('shows "Discovering interpreters" during Discovering phase', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				langMock.onDidChangeRuntimeStartupPhase.fire(RuntimeStartupPhase.Discovering);
			});

			screen.getByText(/Discovering interpreters/);
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
			rtl.render(<StartupStatus />);

			// Simulate discovering 2 runtimes
			act(() => {
				langMock.registeredRuntimes.push({} as ILanguageRuntimeMetadata);
				langMock.onDidRegisterRuntime.fire({} as ILanguageRuntimeMetadata);
			});
			act(() => {
				langMock.registeredRuntimes.push({} as ILanguageRuntimeMetadata);
				langMock.onDidRegisterRuntime.fire({} as ILanguageRuntimeMetadata);
			});

			// The count is rendered in a sibling <span> of the "Discovering interpreters"
			// text; toHaveTextContent matches against the full normalized textContent
			// of the element, which includes nested span text.
			expect(screen.getByText(/Discovering interpreters/)).toHaveTextContent('(2)');
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

			screen.getByText('Python 3.12.1');
			screen.getByText('Preparing');
		});

		it('shows "Reconnecting" for existing session auto-start', () => {
			rtl.render(<StartupStatus />);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent({
					activate: true,
					newSession: false,
				}));
			});

			screen.getByText('Python 3.12.1');
			screen.getByText('Reconnecting');
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
			screen.getByText(/Starting/);
		});

		it('suppresses phase text when auto-start event is active', () => {
			rtl.render(<StartupStatus />);

			// Initially shows "Starting..."
			screen.getByText(/Starting/);

			act(() => {
				startupMock.onWillAutoStartRuntime.fire(makeAutoStartEvent());
			});

			// "Starting" text should be suppressed, replaced by runtime progress.
			screen.getByText('Python 3.12.1');
			// The phase-specific text ("Starting...") is hidden when runtimeStartupEvent
			// is set; the .starting div is no longer rendered.
			expect(screen.queryByText(/^Starting/)).not.toBeInTheDocument();
		});
	});
});
