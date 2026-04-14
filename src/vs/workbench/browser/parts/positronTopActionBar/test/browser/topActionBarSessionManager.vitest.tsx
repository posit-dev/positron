/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-no-dangerous-type-assertions

/// <reference types="vitest/globals" />

import React from 'react';
import { act } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { Emitter } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionDisplayInfo } from '../../../../../services/runtimeSession/common/runtimeSessionService.js';
import { setupRTLRenderer } from '../../../../../../base/test/browser/reactTestingLibrary.js';
import { TopActionBarSessionManager } from '../../components/topActionBarSessionManager.js';
import { ensureNoLeakedDisposables } from '../../../../../../base/test/common/vitestUtils.js';
import { PositronActionBarContextProvider } from '../../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { CommandCenter } from '../../../../../../platform/commandCenter/common/commandCenter.js';
import { LANGUAGE_RUNTIME_SELECT_SESSION_ID, LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID } from '../../../../../contrib/languageRuntime/browser/languageRuntimeActions.js';

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

/**
 * Creates a mock runtime session service with configurable initial state.
 */
function createMockRuntimeSessionService(options?: {
	foregroundInfo?: IRuntimeSessionDisplayInfo;
	hasActiveConsoleSessions?: boolean;
}) {
	const emitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();

	const activeSessions = options?.hasActiveConsoleSessions
		? [{ metadata: { sessionMode: LanguageRuntimeSessionMode.Console } }]
		: [];

	return {
		service: {
			foregroundSessionDisplayInfo: options?.foregroundInfo,
			activeSessions,
			onDidChangeForegroundSessionDisplayInfo: emitter.event,
		},
		emitter,
	};
}

/**
 * Creates the full set of mock services needed to render TopActionBarSessionManager.
 *
 * TopActionBarSessionManager uses runtimeSessionService directly.
 * Its child ActionBarCommandButton needs services + PositronActionBarContext.
 * PositronActionBarContextProvider (which provides ActionBarContext) needs:
 *   - configurationService (getValue, onDidChangeConfiguration)
 *   - hoverService (showInstantHover, hideHover, showHover)
 *   - contextKeyService (onDidChangeContext, contextMatchesRules)
 *   - accessibilityService
 * ActionBarCommandButton also needs:
 *   - commandService (executeCommand)
 *   - keybindingService (lookupKeybinding)
 */
function createTestServices(runtimeSessionService: ReturnType<typeof createMockRuntimeSessionService>['service']) {
	const configEmitter = new Emitter<{ affectsConfiguration: (key: string) => boolean }>();
	const contextKeyEmitter = new Emitter<{ affectsSome: (keys: Set<string>) => boolean }>();

	return {
		runtimeSessionService,
		configurationService: {
			getValue: () => 300 as unknown,
			onDidChangeConfiguration: configEmitter.event,
		},
		hoverService: {
			showInstantHover: () => ({ dispose: () => { } }),
			showHover: () => ({ dispose: () => { } }),
			hideHover: () => { },
		},
		contextKeyService: {
			onDidChangeContext: contextKeyEmitter.event,
			contextMatchesRules: () => true,
		},
		accessibilityService: {},
		commandService: {
			executeCommand: vi.fn().mockResolvedValue(undefined),
		},
		keybindingService: {
			lookupKeybinding: () => undefined,
		},
		_configEmitter: configEmitter,
		_contextKeyEmitter: contextKeyEmitter,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Register the commands that TopActionBarSessionManager uses so that
// ActionBarCommandButton considers them enabled.
CommandCenter.addCommandInfo({
	id: LANGUAGE_RUNTIME_SELECT_SESSION_ID,
	title: 'Select Session',
});
CommandCenter.addCommandInfo({
	id: LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID,
	title: 'Start New Console Session',
});

describe('TopActionBarSessionManager', () => {
	const disposables = ensureNoLeakedDisposables();

	describe('no session', () => {
		const { service, emitter } = createMockRuntimeSessionService();
		const services = createTestServices(service);
		const rtl = setupRTLRenderer(services);

		afterAll(() => {
			emitter.dispose();
			services._configEmitter.dispose();
			services._contextKeyEmitter.dispose();
		});

		it('renders "Start Session" label when no foreground session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toMatchInlineSnapshot(`"Start Session"`);
		});

		it('renders arrow-swap icon when no foreground session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const icon = container.querySelector('.action-bar-button-icon');
			expect(icon?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-arrow-swap"`);
		});

		it('uses start-new-console-session command when no active console sessions', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const button = container.querySelector('button');
			expect(button).toBeTruthy();
		});
	});

	describe('console session', () => {
		const consoleInfo = makeDisplayInfo({
			sessionName: 'Python 3.12.1',
			sessionMode: LanguageRuntimeSessionMode.Console,
		});
		const { service, emitter } = createMockRuntimeSessionService({
			foregroundInfo: consoleInfo,
			hasActiveConsoleSessions: true,
		});
		const services = createTestServices(service);
		const rtl = setupRTLRenderer(services);

		afterAll(() => {
			emitter.dispose();
			services._configEmitter.dispose();
			services._contextKeyEmitter.dispose();
		});

		it('renders session name as label for console session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toMatchInlineSnapshot(`"Python 3.12.1"`);
		});

		it('renders positron-new-console icon for console session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const icon = container.querySelector('.action-bar-button-icon');
			expect(icon?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-positron-new-console"`);
		});
	});

	describe('notebook session', () => {
		const notebookInfo = makeDisplayInfo({
			sessionName: 'Python 3.12.1',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: URI.file('/workspace/analysis.ipynb'),
		});
		const { service, emitter } = createMockRuntimeSessionService({
			foregroundInfo: notebookInfo,
			hasActiveConsoleSessions: false,
		});
		const services = createTestServices(service);
		const rtl = setupRTLRenderer(services);

		afterAll(() => {
			emitter.dispose();
			services._configEmitter.dispose();
			services._contextKeyEmitter.dispose();
		});

		it('renders "notebookName - sessionName" label for notebook session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toMatchInlineSnapshot(`"analysis.ipynb - Python 3.12.1"`);
		});

		it('renders notebook icon for notebook session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const icon = container.querySelector('.action-bar-button-icon');
			expect(icon?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-notebook"`);
		});
	});

	describe('notebook session without notebookUri', () => {
		const notebookInfoNoUri = makeDisplayInfo({
			sessionName: 'R 4.3.2',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: undefined,
		});
		const { service, emitter } = createMockRuntimeSessionService({
			foregroundInfo: notebookInfoNoUri,
		});
		const services = createTestServices(service);
		const rtl = setupRTLRenderer(services);

		afterAll(() => {
			emitter.dispose();
			services._configEmitter.dispose();
			services._contextKeyEmitter.dispose();
		});

		it('falls through to sessionName when notebook has no URI', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toMatchInlineSnapshot(`"R 4.3.2"`);
		});
	});

	describe('session changes via event', () => {
		const { service, emitter } = createMockRuntimeSessionService();
		const services = createTestServices(service);
		const rtl = setupRTLRenderer(services);

		afterAll(() => {
			emitter.dispose();
			services._configEmitter.dispose();
			services._contextKeyEmitter.dispose();
		});

		it('updates label when foreground session changes to a console session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			expect(container.querySelector('.action-bar-button-label')?.textContent).toMatchInlineSnapshot(`"Start Session"`);

			// Fire event with a console session inside act() to flush React state updates
			act(() => {
				emitter.fire(makeDisplayInfo({
					sessionName: 'R 4.3.2',
					sessionMode: LanguageRuntimeSessionMode.Console,
				}));
			});

			// Re-query after act to get updated DOM
			expect(container.querySelector('.action-bar-button-label')?.textContent).toMatchInlineSnapshot(`"R 4.3.2"`);
		});

		it('updates label when foreground session changes to a notebook session', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			act(() => {
				emitter.fire(makeDisplayInfo({
					sessionName: 'Python 3.12.1',
					sessionMode: LanguageRuntimeSessionMode.Notebook,
					notebookUri: URI.file('/workspace/report.ipynb'),
				}));
			});

			expect(container.querySelector('.action-bar-button-label')?.textContent).toMatchInlineSnapshot(`"report.ipynb - Python 3.12.1"`);
		});

		it('updates icon when session changes from none to console', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			expect(container.querySelector('.action-bar-button-icon')?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-arrow-swap"`);

			act(() => {
				emitter.fire(makeDisplayInfo());
			});

			expect(container.querySelector('.action-bar-button-icon')?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-positron-new-console"`);
		});

		it('updates icon when session changes to notebook', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			act(() => {
				emitter.fire(makeDisplayInfo({
					sessionMode: LanguageRuntimeSessionMode.Notebook,
					notebookUri: URI.file('/workspace/nb.ipynb'),
				}));
			});

			expect(container.querySelector('.action-bar-button-icon')?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-notebook"`);
		});

		it('reverts to "Start Session" when session is cleared', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			act(() => {
				emitter.fire(makeDisplayInfo({ sessionName: 'Python 3.12.1' }));
			});
			expect(container.querySelector('.action-bar-button-label')?.textContent).toMatchInlineSnapshot(`"Python 3.12.1"`);

			act(() => {
				emitter.fire(undefined);
			});
			expect(container.querySelector('.action-bar-button-label')?.textContent).toMatchInlineSnapshot(`"Start Session"`);
		});

		it('reverts to arrow-swap icon when session is cleared', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			act(() => {
				emitter.fire(makeDisplayInfo());
			});
			expect(container.querySelector('.action-bar-button-icon')?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-positron-new-console"`);

			act(() => {
				emitter.fire(undefined);
			});
			expect(container.querySelector('.action-bar-button-icon')?.className).toMatchInlineSnapshot(`"action-bar-button-icon codicon codicon-arrow-swap"`);
		});
	});

	describe('command ID selection - with active console sessions', () => {
		const { service, emitter } = createMockRuntimeSessionService({
			hasActiveConsoleSessions: true,
		});
		const services = createTestServices(service);
		const rtl = setupRTLRenderer(services);

		afterAll(() => {
			emitter.dispose();
			services._configEmitter.dispose();
			services._contextKeyEmitter.dispose();
		});

		it('uses selectSession command when there are active console sessions', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const button = container.querySelector('button')!;
			fireEvent.click(button);

			expect(services.commandService.executeCommand).toHaveBeenCalledWith(
				'workbench.action.language.runtime.selectSession'
			);
		});
	});

	describe('command ID selection - without active console sessions', () => {
		const { service, emitter } = createMockRuntimeSessionService({
			hasActiveConsoleSessions: false,
		});
		const services = createTestServices(service);
		const rtl = setupRTLRenderer(services);

		afterAll(() => {
			emitter.dispose();
			services._configEmitter.dispose();
			services._contextKeyEmitter.dispose();
		});

		it('uses startNewConsoleSession command when no active console sessions', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			const button = container.querySelector('button')!;
			fireEvent.click(button);

			expect(services.commandService.executeCommand).toHaveBeenCalledWith(
				'workbench.action.language.runtime.startNewConsoleSession'
			);
		});
	});
});
