/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Position } from '../../../../../editor/common/core/position.js';
import { EditorType } from '../../../../../editor/common/editorCommon.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { CellUri } from '../../../notebook/common/notebookCommon.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, INotebookLanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IVariableItem } from '../../../../services/positronVariables/common/interfaces/variableItem.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { Event } from '../../../../../base/common/event.js';
import { POSITRON_VARIABLES_VIEW_ID } from '../../../positronVariables/browser/positronVariables.contribution.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import {
	PositronDataExplorerCommandId,
	PositronDataExplorerViewDataFrameAtCursorAction,
	PositronDataExplorerViewDataFrameByVariableAction,
} from '../../browser/positronDataExplorerActions.js';

const SESSION_ID = 'test-session-id';

// Test doubles below use `as unknown as <Service>` because the services have
// large surface areas we don't exercise. Disabling the rule locally keeps the
// helpers readable; the trade-off is that a real missing field won't be caught
// by the compiler -- acceptable for tightly scoped unit tests.
/* eslint-disable local/code-no-dangerous-type-assertions */
const makeSession = (languageId: string, sessionId = SESSION_ID): ILanguageRuntimeSession =>
({
	sessionId,
	runtimeMetadata: { languageId },
	metadata: { sessionMode: LanguageRuntimeSessionMode.Console },
} as unknown as ILanguageRuntimeSession);

const makeCodeEditor = (options: {
	word?: string;
	languageId?: string;
	languageIdAtPosition?: string;
	uri?: URI;
} = {}): ICodeEditor => {
	const {
		word,
		languageId = 'r',
		languageIdAtPosition = languageId,
		uri = URI.parse('file:///test.R'),
	} = options;
	const model = {
		uri,
		getWordAtPosition: vi.fn().mockReturnValue(word ? { word, startColumn: 1, endColumn: word.length + 1 } : null),
		getLanguageId: () => languageId,
		getLanguageIdAtPosition: () => languageIdAtPosition,
	};
	return {
		getEditorType: () => EditorType.ICodeEditor,
		getModel: () => model,
		getPosition: () => new Position(1, 1),
	} as unknown as ICodeEditor;
};

const makeVariableItem = (overrides: Partial<IVariableItem> = {}): IVariableItem =>
({
	id: 'item-id',
	path: [],
	hasViewer: true,
	displayName: 'df',
	view: vi.fn().mockResolvedValue(undefined),
	...overrides,
} as unknown as IVariableItem);

const makeVariablesInstance = (
	items: IVariableItem[],
	sessionId = SESSION_ID,
): IPositronVariablesInstance =>
({
	session: { sessionId },
	variableItems: items,
	onDidChangeEntries: Event.None,
} as unknown as IPositronVariablesInstance);
/* eslint-enable local/code-no-dangerous-type-assertions */

describe('PositronDataExplorerViewDataFrameAtCursorAction', () => {
	describe('metadata', () => {
		createTestContainer().build();

		it('registers with the expected id, f1, and editor context menu', () => {
			const action = new PositronDataExplorerViewDataFrameAtCursorAction();
			expect(action.desc.id).toBe(PositronDataExplorerCommandId.ViewDataFrameAtCursorAction);
			expect(action.desc.f1).toBe(true);
			const menus = Array.isArray(action.desc.menu) ? action.desc.menu : [action.desc.menu];
			expect(menus.some(m => m?.id.id === 'EditorContext')).toBe(true);
		});
	});

	describe('run()', () => {
		// Mutable per-test state. Each test configures these via beforeEach hooks before
		// invoking the action.
		let activeEditor: ICodeEditor | undefined;
		let session: ILanguageRuntimeSession | undefined;
		let activeSessions: ILanguageRuntimeSession[];
		let getConsoleSessionForLanguage: ReturnType<typeof vi.fn<(id: string) => ILanguageRuntimeSession | undefined>>;
		let getNotebookSessionForNotebookUri: ReturnType<typeof vi.fn<(uri: URI) => INotebookLanguageRuntimeSession | undefined>>;
		let variablesInstances: IPositronVariablesInstance[];
		let openViewStub: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;
		let notificationInfo: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
		let notificationError: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

		const ctx = createTestContainer()
			.stub(IEditorService, {
				get activeTextEditorControl() { return activeEditor; },
			})
			.stub(ILanguageService, {
				getLanguageName: (id: string) => id === 'r' ? 'R' : id === 'python' ? 'Python' : null,
			})
			.stub(IRuntimeSessionService, {
				getConsoleSessionForLanguage: (id: string) => getConsoleSessionForLanguage(id),
				getNotebookSessionForNotebookUri: (uri: URI) => getNotebookSessionForNotebookUri(uri),
				get activeSessions() { return activeSessions; },
			})
			.stub(IPositronVariablesService, {
				get positronVariablesInstances() { return variablesInstances; },
			})
			.stub(IPositronDataExplorerService, {
				getInstanceForVar: () => undefined,
				getInstanceForVariablePath: () => undefined,
				setInstanceForVar: vi.fn(),
			})
			.stub(INotificationService, {
				info: (...args: unknown[]) => notificationInfo(...args),
				error: (...args: unknown[]) => notificationError(...args),
			})
			.stub(IViewsService, {
				openView: (...args: unknown[]) => openViewStub(...args),
			})
			.build();

		beforeEach(() => {
			activeEditor = undefined;
			session = undefined;
			activeSessions = [];
			getConsoleSessionForLanguage = vi.fn(() => session);
			getNotebookSessionForNotebookUri = vi.fn().mockReturnValue(undefined);
			variablesInstances = [];
			openViewStub = vi.fn().mockResolvedValue(null);
			notificationInfo = vi.fn();
			notificationError = vi.fn();
		});

		const runAction = () => {
			const action = new PositronDataExplorerViewDataFrameAtCursorAction();
			return ctx.instantiationService.invokeFunction(accessor => action.run(accessor));
		};

		it('notifies when no code editor is active', async () => {
			activeEditor = undefined;

			await runAction();

			expect(notificationInfo).toHaveBeenCalledTimes(1);
			expect(notificationInfo.mock.calls[0][0]).toMatch(/Place the cursor in the editor/);
			expect(notificationError).not.toHaveBeenCalled();
		});

		it('notifies when there is no word at the cursor', async () => {
			activeEditor = makeCodeEditor({ word: undefined });

			await runAction();

			expect(notificationInfo).toHaveBeenCalledTimes(1);
			expect(notificationInfo.mock.calls[0][0]).toMatch(/No symbol at cursor/);
		});

		it('notifies with "R" when no R session is active', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = undefined;

			await runAction();

			expect(notificationInfo).toHaveBeenCalledTimes(1);
			expect(notificationInfo.mock.calls[0][0]).toMatch(/No active R session/);
		});

		it('falls back to a running console session when no foreground session matches', async () => {
			// getConsoleSessionForLanguage returns undefined (nothing foregrounded for R),
			// but a running R console exists in activeSessions. We expect the lookup to
			// fall through to activeSessions rather than notify "no active R session".
			const runningRSession = makeSession('r', 'bg-r-session');
			const viewStub = vi.fn().mockResolvedValue(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = undefined;
			activeSessions = [runningRSession];
			variablesInstances = [makeVariablesInstance([item], 'bg-r-session')];

			await runAction();

			expect(viewStub).toHaveBeenCalledTimes(1);
			expect(notificationInfo).not.toHaveBeenCalled();
		});

		it('opens the Variables pane when no instance exists, then retries', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [];

			const viewStub = vi.fn().mockResolvedValue(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			openViewStub.mockImplementation(async () => {
				// Simulate the pane opening: the instance appears with items
				// already populated (as if the runtime returned them fast).
				variablesInstances = [makeVariablesInstance([item])];
				return null;
			});

			await runAction();

			expect(openViewStub).toHaveBeenCalledTimes(1);
			expect(openViewStub.mock.calls[0]).toEqual([POSITRON_VARIABLES_VIEW_ID, false]);
			expect(viewStub).toHaveBeenCalledTimes(1);
			expect(notificationInfo).not.toHaveBeenCalled();
		});

		it('notifies when the Variables pane opens but still has no instance', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [];
			// openViewStub default does not populate variablesInstances.

			await runAction();

			expect(openViewStub).toHaveBeenCalledTimes(1);
			expect(notificationInfo).toHaveBeenCalledTimes(1);
			expect(notificationInfo.mock.calls[0][0]).toMatch(/Variables for the active R session/);
		});

		it('notifies when the symbol is not a data frame in the session', async () => {
			activeEditor = makeCodeEditor({ word: 'missing', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [makeVariablesInstance([makeVariableItem({ displayName: 'df' })])];

			await runAction();

			expect(notificationInfo).toHaveBeenCalledTimes(1);
			expect(notificationInfo.mock.calls[0][0]).toMatch(/'missing' is not a data frame defined/);
		});

		it('notifies about a still-loading session when the variables list times out', async () => {
			vi.useFakeTimers();
			try {
				activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
				session = makeSession('r');
				// Empty variableItems + Event.None (never fires) forces the
				// waitForVariables helper to hit its timeout.
				variablesInstances = [makeVariablesInstance([])];

				const runPromise = runAction();
				await vi.advanceTimersByTimeAsync(5000);
				await runPromise;

				expect(notificationInfo).toHaveBeenCalledTimes(1);
				expect(notificationInfo.mock.calls[0][0]).toMatch(/still loading variables/);
			} finally {
				vi.useRealTimers();
			}
		});

		it('notifies when the symbol exists but is not viewable', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [
				makeVariablesInstance([makeVariableItem({ displayName: 'df', hasViewer: false })]),
			];

			await runAction();

			expect(notificationInfo).toHaveBeenCalledTimes(1);
			expect(notificationInfo.mock.calls[0][0]).toMatch(/'df' is not viewable/);
		});

		it('uses the embedded language at cursor for language-embedded documents', async () => {
			const viewStub = vi.fn().mockResolvedValue(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			const rSession = makeSession('r');
			// Outer document is Quarto but the cursor sits inside an R chunk.
			activeEditor = makeCodeEditor({
				word: 'df',
				languageId: 'quarto',
				languageIdAtPosition: 'r',
			});
			// The session lookup only returns a session when called with 'r'.
			getConsoleSessionForLanguage = vi.fn((id: string) => id === 'r' ? rSession : undefined);
			variablesInstances = [makeVariablesInstance([item])];

			await runAction();

			expect(getConsoleSessionForLanguage.mock.calls[0]).toEqual(['r']);
			expect(viewStub).toHaveBeenCalledTimes(1);
			expect(notificationInfo).not.toHaveBeenCalled();
		});

		it('uses the notebook session when the cursor is inside a notebook cell', async () => {
			const viewStub = vi.fn().mockResolvedValue(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			const notebookUri = URI.parse('file:///test.ipynb');
			// Cell URIs are what cell editors expose; parsing them yields the owning notebook URI.
			const cellUri = CellUri.generate(notebookUri, 1);
			const notebookSession = makeSession('python') as unknown as INotebookLanguageRuntimeSession;
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'python', uri: cellUri });
			getNotebookSessionForNotebookUri = vi.fn(
				(uri: URI) => uri.toString() === notebookUri.toString() ? notebookSession : undefined,
			);
			variablesInstances = [makeVariablesInstance([item])];

			await runAction();

			expect(getConsoleSessionForLanguage).not.toHaveBeenCalled();
			expect(getNotebookSessionForNotebookUri).toHaveBeenCalledTimes(1);
			expect(getNotebookSessionForNotebookUri.mock.calls[0][0].toString()).toBe(notebookUri.toString());
			expect(viewStub).toHaveBeenCalledTimes(1);
			expect(notificationInfo).not.toHaveBeenCalled();
		});
	});
});

describe('PositronDataExplorerViewDataFrameByVariableAction', () => {
	let variablesInstances: IPositronVariablesInstance[];

	const ctx = createTestContainer()
		.stub(IPositronVariablesService, {
			get positronVariablesInstances() { return variablesInstances; },
		})
		.stub(IPositronDataExplorerService, {
			getInstanceForVar: () => undefined,
			getInstanceForVariablePath: () => undefined,
			setInstanceForVar: vi.fn(),
		})
		.stub(INotificationService, {
			info: vi.fn(),
			error: vi.fn(),
		})
		.build();

	beforeEach(() => {
		variablesInstances = [];
	});

	const runAction = (args?: { sessionId: string; variableId: string }) => {
		const action = new PositronDataExplorerViewDataFrameByVariableAction();
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor, args));
	};

	it('opens the viewer for the resolved variable', async () => {
		const viewStub = vi.fn().mockResolvedValue(undefined);
		const item = makeVariableItem({ id: 'item-id', view: viewStub as unknown as IVariableItem['view'] });
		variablesInstances = [makeVariablesInstance([item])];

		await runAction({ sessionId: SESSION_ID, variableId: 'item-id' });

		expect(viewStub).toHaveBeenCalledTimes(1);
	});

	it('does nothing when the variable no longer exists in the session', async () => {
		const viewStub = vi.fn().mockResolvedValue(undefined);
		variablesInstances = [makeVariablesInstance([makeVariableItem({ id: 'other-id', view: viewStub as unknown as IVariableItem['view'] })])];

		await runAction({ sessionId: SESSION_ID, variableId: 'item-id' });

		expect(viewStub).not.toHaveBeenCalled();
	});
});
