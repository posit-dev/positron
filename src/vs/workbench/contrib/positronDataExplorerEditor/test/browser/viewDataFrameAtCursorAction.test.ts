/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { Position } from '../../../../../editor/common/core/position.js';
import { EditorType } from '../../../../../editor/common/editorCommon.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IVariableItem } from '../../../../services/positronVariables/common/interfaces/variableItem.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { Event } from '../../../../../base/common/event.js';
import { POSITRON_VARIABLES_VIEW_ID } from '../../../positronVariables/browser/positronVariables.contribution.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import {
	PositronDataExplorerCommandId,
	PositronDataExplorerViewDataFrameAtCursorAction,
} from '../../browser/positronDataExplorerActions.js';

const SESSION_ID = 'test-session-id';

const makeSession = (languageId: string): ILanguageRuntimeSession =>
	({ sessionId: SESSION_ID, runtimeMetadata: { languageId } } as unknown as ILanguageRuntimeSession);

const makeCodeEditor = (options: {
	word?: string;
	languageId?: string;
	languageIdAtPosition?: string;
} = {}): ICodeEditor => {
	const { word, languageId = 'r', languageIdAtPosition = languageId } = options;
	const model = {
		getWordAtPosition: sinon.stub().returns(word ? { word, startColumn: 1, endColumn: word.length + 1 } : null),
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
	view: sinon.stub().resolves(undefined),
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

suite('PositronDataExplorerViewDataFrameAtCursorAction', () => {
	suite('metadata', () => {
		createTestContainer().build();

		test('registers with the expected id, f1, and editor context menu', () => {
			const action = new PositronDataExplorerViewDataFrameAtCursorAction();
			assert.strictEqual(
				action.desc.id,
				PositronDataExplorerCommandId.ViewDataFrameAtCursorAction,
			);
			assert.strictEqual(action.desc.f1, true);
			const menus = Array.isArray(action.desc.menu) ? action.desc.menu : [action.desc.menu];
			assert.ok(
				menus.some(m => m?.id.id === 'EditorContext'),
				'action should contribute to the editor context menu',
			);
		});
	});

	suite('run()', () => {
		// Mutable per-test state. Each test configures these via setup hooks before
		// invoking the action.
		let activeEditor: ICodeEditor | undefined;
		let session: ILanguageRuntimeSession | undefined;
		let getConsoleSessionForLanguage: sinon.SinonStub;
		let variablesInstances: IPositronVariablesInstance[];
		let openViewStub: sinon.SinonStub;
		let notificationInfo: sinon.SinonStub;
		let notificationError: sinon.SinonStub;

		const ctx = createTestContainer()
			.stub(IEditorService, {
				get activeTextEditorControl() { return activeEditor; },
			} as Partial<IEditorService>)
			.stub(ILanguageService, {
				getLanguageName: (id: string) => id === 'r' ? 'R' : id === 'python' ? 'Python' : null,
			} as Partial<ILanguageService>)
			.stub(IRuntimeSessionService, {
				getConsoleSessionForLanguage: (id: string) => getConsoleSessionForLanguage(id),
			} as Partial<IRuntimeSessionService>)
			.stub(IPositronVariablesService, {
				get positronVariablesInstances() { return variablesInstances; },
			} as Partial<IPositronVariablesService>)
			.stub(IPositronDataExplorerService, {
				getInstanceForVar: () => undefined,
				getInstanceForVariablePath: () => undefined,
				setInstanceForVar: sinon.stub(),
			} as Partial<IPositronDataExplorerService>)
			.stub(INotificationService, {
				info: (...args: any[]) => notificationInfo(...args),
				error: (...args: any[]) => notificationError(...args),
			} as Partial<INotificationService>)
			.stub(IViewsService, {
				openView: (...args: any[]) => openViewStub(...args),
			} as Partial<IViewsService>)
			.build();

		setup(() => {
			activeEditor = undefined;
			session = undefined;
			getConsoleSessionForLanguage = sinon.stub().callsFake(() => session);
			variablesInstances = [];
			openViewStub = sinon.stub().resolves(null);
			notificationInfo = sinon.stub();
			notificationError = sinon.stub();
		});

		const runAction = () => {
			const action = new PositronDataExplorerViewDataFrameAtCursorAction();
			return ctx.instantiationService.invokeFunction(accessor => action.run(accessor));
		};

		test('notifies when no code editor is active', async () => {
			activeEditor = undefined;

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /Place the cursor in the editor/);
			assert.strictEqual(notificationError.callCount, 0);
		});

		test('notifies when there is no word at the cursor', async () => {
			activeEditor = makeCodeEditor({ word: undefined });

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /No symbol at cursor/);
		});

		test('notifies with "R" when no R session is active', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = undefined;

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /No active R session/);
		});

		test('opens the Variables pane when no instance exists, then retries', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [];

			const viewStub = sinon.stub().resolves(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			openViewStub.callsFake(async () => {
				// Simulate the pane opening: the instance appears with items
				// already populated (as if the runtime returned them fast).
				variablesInstances = [makeVariablesInstance([item])];
				return null;
			});

			await runAction();

			assert.strictEqual(openViewStub.callCount, 1);
			assert.deepStrictEqual(openViewStub.firstCall.args, [POSITRON_VARIABLES_VIEW_ID, false]);
			assert.strictEqual(viewStub.callCount, 1);
			assert.strictEqual(notificationInfo.callCount, 0);
		});

		test('notifies when the Variables pane opens but still has no instance', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [];
			// openViewStub default does not populate variablesInstances.

			await runAction();

			assert.strictEqual(openViewStub.callCount, 1);
			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /Variables for the active R session/);
		});

		test('notifies when the symbol is not a data frame in the session', async () => {
			activeEditor = makeCodeEditor({ word: 'missing', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [makeVariablesInstance([makeVariableItem({ displayName: 'df' })])];

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /'missing' is not a data frame defined/);
		});

		test('notifies about a still-loading session when the variables list times out', async () => {
			const clock = sinon.useFakeTimers();
			try {
				activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
				session = makeSession('r');
				// Empty variableItems + Event.None (never fires) forces the
				// waitForVariables helper to hit its timeout.
				variablesInstances = [makeVariablesInstance([])];

				const runPromise = runAction();
				await clock.tickAsync(5000);
				await runPromise;

				assert.strictEqual(notificationInfo.callCount, 1);
				assert.match(notificationInfo.firstCall.args[0], /still loading variables/);
			} finally {
				clock.restore();
			}
		});

		test('notifies when the symbol exists but is not viewable', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [
				makeVariablesInstance([makeVariableItem({ displayName: 'df', hasViewer: false })]),
			];

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /'df' is not viewable/);
		});

		test('uses the embedded language at cursor for language-embedded documents', async () => {
			const viewStub = sinon.stub().resolves(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			const rSession = makeSession('r');
			// Outer document is Quarto but the cursor sits inside an R chunk.
			activeEditor = makeCodeEditor({
				word: 'df',
				languageId: 'quarto',
				languageIdAtPosition: 'r',
			});
			// The session lookup only returns a session when called with 'r'.
			getConsoleSessionForLanguage = sinon.stub().callsFake(
				(id: string) => id === 'r' ? rSession : undefined,
			);
			variablesInstances = [makeVariablesInstance([item])];

			await runAction();

			assert.deepStrictEqual(getConsoleSessionForLanguage.firstCall.args, ['r']);
			assert.strictEqual(viewStub.callCount, 1);
			assert.strictEqual(notificationInfo.callCount, 0);
		});
	});
});
