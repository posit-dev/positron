/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import React from 'react';
import { act, fireEvent } from '@testing-library/react';
import { Emitter } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionDisplayInfo, IRuntimeSessionService } from '../../../../../services/runtimeSession/common/runtimeSessionService.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { TopActionBarSessionManager } from '../../components/topActionBarSessionManager.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { CommandCenter } from '../../../../../../platform/commandCenter/common/commandCenter.js';
import { LANGUAGE_RUNTIME_SELECT_SESSION_ID, LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID } from '../../../../../contrib/languageRuntime/browser/languageRuntimeActions.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock IRuntimeSessionDisplayInfo with sensible defaults.
 */
function makeDisplayInfo(
	overrides: Partial<IRuntimeSessionDisplayInfo> = {}
): IRuntimeSessionDisplayInfo {
	return {
		sessionName: 'Python 3.12.1',
		sessionMode: LanguageRuntimeSessionMode.Console,
		notebookUri: undefined,
		runtimeId: 'python-3.12.1',
		languageName: 'Python',
		languageId: 'python',
		base64EncodedIconSvg: undefined,
		sessionState: RuntimeState.Idle,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TopActionBarSessionManager', () => {
	// Register commands in beforeAll so they are set up in a test lifecycle
	// hook rather than at module scope. CommandCenter has no deregistration
	// API, but Vitest isolates modules per file so this won't leak to other
	// test files.
	beforeAll(() => {
		CommandCenter.addCommandInfo({
			id: LANGUAGE_RUNTIME_SELECT_SESSION_ID,
			title: 'Select Session',
		});
		CommandCenter.addCommandInfo({
			id: LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID,
			title: 'Start New Console Session',
		});
	});

	describe('no session', () => {
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: undefined,
				activeSessions: [],
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('renders "Start Session" label when no foreground session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toBe('Start Session');
		});

		it('renders arrow-swap icon when no foreground session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const icon = container.querySelector('.action-bar-button-icon');
			expect(icon?.className).toBe('action-bar-button-icon codicon codicon-arrow-swap');
		});

		it('renders a button when no active console sessions', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const button = container.querySelector('button');
			expect(button).not.toBeNull();
		});
	});

	describe('console session', () => {
		const consoleInfo = makeDisplayInfo({
			sessionName: 'Python 3.12.1',
			sessionMode: LanguageRuntimeSessionMode.Console,
		});
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: consoleInfo,
				activeSessions: [{ metadata: { sessionMode: LanguageRuntimeSessionMode.Console } }] as any,
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('renders session name as label for console session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toBe('Python 3.12.1');
		});

		it('renders positron-new-console icon for console session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const icon = container.querySelector('.action-bar-button-icon');
			expect(icon?.className).toBe('action-bar-button-icon codicon codicon-positron-new-console');
		});
	});

	describe('notebook session', () => {
		const notebookInfo = makeDisplayInfo({
			sessionName: 'Python 3.12.1',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: URI.file('/workspace/analysis.ipynb'),
		});
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: notebookInfo,
				activeSessions: [],
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('renders "notebookName - sessionName" label for notebook session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toBe('analysis.ipynb - Python 3.12.1');
		});

		it('renders notebook icon for notebook session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const icon = container.querySelector('.action-bar-button-icon');
			expect(icon?.className).toBe('action-bar-button-icon codicon codicon-notebook');
		});
	});

	describe('notebook session without notebookUri', () => {
		const notebookInfoNoUri = makeDisplayInfo({
			sessionName: 'R 4.3.2',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: undefined,
		});
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: notebookInfoNoUri,
				activeSessions: [],
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('falls through to sessionName when notebook has no URI', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toBe('R 4.3.2');
		});
	});

	describe('session changes via event', () => {
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: undefined,
				activeSessions: [],
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('updates label when foreground session changes to a console session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('Start Session');

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({
					sessionName: 'R 4.3.2',
					sessionMode: LanguageRuntimeSessionMode.Console,
				}));
			});

			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('R 4.3.2');
		});

		it('updates label when foreground session changes to a notebook session', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({
					sessionName: 'Python 3.12.1',
					sessionMode: LanguageRuntimeSessionMode.Notebook,
					notebookUri: URI.file('/workspace/report.ipynb'),
				}));
			});

			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('report.ipynb - Python 3.12.1');
		});

		it('updates icon when session changes from none to console', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			expect(container.querySelector('.action-bar-button-icon')?.className).toBe('action-bar-button-icon codicon codicon-arrow-swap');

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo());
			});

			expect(container.querySelector('.action-bar-button-icon')?.className).toBe('action-bar-button-icon codicon codicon-positron-new-console');
		});

		it('updates icon when session changes to notebook', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({
					sessionMode: LanguageRuntimeSessionMode.Notebook,
					notebookUri: URI.file('/workspace/nb.ipynb'),
				}));
			});

			expect(container.querySelector('.action-bar-button-icon')?.className).toBe('action-bar-button-icon codicon codicon-notebook');
		});

		it('reverts to "Start Session" when session is cleared', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({ sessionName: 'Python 3.12.1' }));
			});
			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('Python 3.12.1');

			act(() => {
				displayInfoEmitter.fire(undefined);
			});
			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('Start Session');
		});

		it('reverts to arrow-swap icon when session is cleared', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo());
			});
			expect(container.querySelector('.action-bar-button-icon')?.className).toBe('action-bar-button-icon codicon codicon-positron-new-console');

			act(() => {
				displayInfoEmitter.fire(undefined);
			});
			expect(container.querySelector('.action-bar-button-icon')?.className).toBe('action-bar-button-icon codicon codicon-arrow-swap');
		});
	});

	describe('command ID selection - with active console sessions', () => {
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: undefined,
				activeSessions: [{ metadata: { sessionMode: LanguageRuntimeSessionMode.Console } }] as any,
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('uses selectSession command when there are active console sessions', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const button = container.querySelector('button')!;
			fireEvent.click(button);

			expect(ctx.get(ICommandService).executeCommand).toHaveBeenCalledWith(
				'workbench.action.language.runtime.selectSession'
			);
		});
	});

	describe('command ID selection - without active console sessions', () => {
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: undefined,
				activeSessions: [],
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('uses startNewConsoleSession command when no active console sessions', () => {
			const { container } = rtl.render(
				<TopActionBarSessionManager />
			);

			const button = container.querySelector('button')!;
			fireEvent.click(button);

			expect(ctx.get(ICommandService).executeCommand).toHaveBeenCalledWith(
				'workbench.action.language.runtime.startNewConsoleSession'
			);
		});
	});
});
