/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Emitter } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionDisplayInfo, IRuntimeSessionService } from '../../../../../services/runtimeSession/common/runtimeSessionService.js';
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
		runtimeName: 'Python',
		languageName: 'Python',
		languageId: 'python',
		base64EncodedIconSvg: undefined,
		sessionState: RuntimeState.Idle,
		...overrides,
	};
}

/**
 * Builds a minimal ILanguageRuntimeSession stub with just the metadata fields
 * the component reads. Typed as Partial so new required fields surface as
 * type errors rather than silently breaking the cast.
 */
function makeConsoleSessionStub(): Partial<ILanguageRuntimeSession> {
	return {
		metadata: {
			sessionMode: LanguageRuntimeSessionMode.Console,
			sessionId: 'test',
			createdTimestamp: 0,
			notebookUri: undefined,
			startReason: 'test',
		},
	};
}

/**
 * Returns the session icon element inside the button. The icon is either
 * <ActionBarButtonIcon> (.action-bar-button-icon) or <RuntimeIcon>
 * (.runtime-session-icon); both live as the first matching child of the button.
 */
function getSessionIcon(button: HTMLElement): Element {
	// eslint-disable-next-line no-restricted-syntax -- no semantic role or label targets the icon; it is a purely decorative element inside an already-labelled button
	const el = button.querySelector('.runtime-session-icon, .action-bar-button-icon');
	if (!el) {
		throw new Error('Session icon element not found inside button');
	}
	return el;
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
			rtl.render(<TopActionBarSessionManager />);
			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('Start Session');
		});

		it('renders the arrow-swap fallback icon when no foreground session', () => {
			rtl.render(<TopActionBarSessionManager />);

			// Without a session we render <ActionBarButtonIcon icon={Codicon.arrowSwap} />,
			// which carries the action-bar-button-icon + codicon classes but not
			// runtime-session-icon (that class is only applied by <RuntimeIcon>).
			const icon = getSessionIcon(screen.getByRole('button', { name: /session/i }));
			expect(icon).toHaveClass('action-bar-button-icon', 'codicon', 'codicon-arrow-swap');
			expect(icon).not.toHaveClass('runtime-session-icon');
		});

		it('renders a button when no active console sessions', () => {
			rtl.render(<TopActionBarSessionManager />);
			expect(screen.getByRole('button', { name: /session/i })).toBeInTheDocument();
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
				activeSessions: [makeConsoleSessionStub() as ILanguageRuntimeSession],
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('renders session name as label for console session', () => {
			rtl.render(<TopActionBarSessionManager />);
			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('Python 3.12.1');
		});

		it('renders a runtime-session-icon for a console session', () => {
			rtl.render(<TopActionBarSessionManager />);
			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).toHaveClass('runtime-session-icon', 'file-icon', 'python-lang-file-icon');
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

		it('renders notebook filename as label for notebook session', () => {
			rtl.render(<TopActionBarSessionManager />);
			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('analysis.ipynb');
		});

		it('renders a runtime-session-icon for a notebook session', () => {
			rtl.render(<TopActionBarSessionManager />);
			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).toHaveClass('runtime-session-icon', 'file-icon', 'ipynb-ext-file-icon');
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
			rtl.render(<TopActionBarSessionManager />);
			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('R 4.3.2');
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
			rtl.render(<TopActionBarSessionManager />);
			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('Start Session');

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({
					sessionName: 'R 4.3.2',
					languageId: 'r',
					sessionMode: LanguageRuntimeSessionMode.Console,
				}));
			});

			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('R 4.3.2');
		});

		it('updates label when foreground session changes to a notebook session', () => {
			rtl.render(<TopActionBarSessionManager />);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({
					sessionName: 'Python 3.12.1',
					sessionMode: LanguageRuntimeSessionMode.Notebook,
					notebookUri: URI.file('/workspace/report.ipynb'),
				}));
			});

			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('report.ipynb');
		});

		it('swaps from the arrow-swap fallback to a runtime-session-icon when a console session appears', () => {
			rtl.render(<TopActionBarSessionManager />);

			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).toHaveClass('codicon-arrow-swap');
			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).not.toHaveClass('runtime-session-icon');

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo());
			});

			expect(getSessionIcon(screen.getByRole('button', { name: /session/i })))
				.toHaveClass('runtime-session-icon');
			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).not.toHaveClass('codicon-arrow-swap');
		});

		it('swaps to a runtime-session-icon when switching to a notebook session', () => {
			rtl.render(<TopActionBarSessionManager />);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({
					sessionMode: LanguageRuntimeSessionMode.Notebook,
					notebookUri: URI.file('/workspace/nb.ipynb'),
				}));
			});

			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).toHaveClass('runtime-session-icon');
		});

		it('reverts to "Start Session" when session is cleared', () => {
			rtl.render(<TopActionBarSessionManager />);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo({ sessionName: 'Python 3.12.1' }));
			});
			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('Python 3.12.1');

			act(() => {
				displayInfoEmitter.fire(undefined);
			});
			expect(screen.getByRole('button', { name: /session/i })).toHaveTextContent('Start Session');
		});

		it('reverts to the arrow-swap fallback icon when session is cleared', () => {
			rtl.render(<TopActionBarSessionManager />);

			act(() => {
				displayInfoEmitter.fire(makeDisplayInfo());
			});
			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).toHaveClass('runtime-session-icon');

			act(() => {
				displayInfoEmitter.fire(undefined);
			});
			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).toHaveClass('codicon-arrow-swap');
			expect(getSessionIcon(screen.getByRole('button', { name: /session/i }))).not.toHaveClass('runtime-session-icon');
		});
	});

	describe('command ID selection - with active console sessions', () => {
		const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();
		const ctx = createTestContainer()
			.withReactServices()
			.stub(IRuntimeSessionService, {
				foregroundSessionDisplayInfo: undefined,
				activeSessions: [makeConsoleSessionStub() as ILanguageRuntimeSession],
				onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
			})
			.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
			.build();
		const rtl = setupRTLRenderer(() => ctx.reactServices);

		it('uses selectSession command when there are active console sessions', async () => {
			const user = userEvent.setup();
			rtl.render(<TopActionBarSessionManager />);

			await user.click(screen.getByRole('button', { name: /session/i }));

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

		it('uses startNewConsoleSession command when no active console sessions', async () => {
			const user = userEvent.setup();
			rtl.render(<TopActionBarSessionManager />);

			await user.click(screen.getByRole('button', { name: /session/i }));

			expect(ctx.get(ICommandService).executeCommand).toHaveBeenCalledWith(
				'workbench.action.language.runtime.startNewConsoleSession'
			);
		});
	});
});
