/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { Position } from '../../../../../editor/common/core/position.js';
import { EditorType } from '../../../../../editor/common/editorCommon.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IPositronDataExplorerInstance } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IVariableItem } from '../../../../services/positronVariables/common/interfaces/variableItem.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import {
	VIEW_DATA_FRAME_AT_CURSOR_ACTION_ID,
	PositronDataExplorerViewDataFrameAtCursorAction,
} from '../../browser/positronDataExplorerViewDataFrameAtCursorAction.js';

const SESSION_ID = 'test-session-id';

const makeSession = (languageId: string): ILanguageRuntimeSession =>
	({ sessionId: SESSION_ID, runtimeMetadata: { languageId } } as unknown as ILanguageRuntimeSession);

const makeCodeEditor = (options: {
	word?: string;
	languageId?: string;
	hasModel?: boolean;
	hasPosition?: boolean;
} = {}): ICodeEditor => {
	const { word, languageId = 'r', hasModel = true, hasPosition = true } = options;
	const model = {
		getWordAtPosition: sinon.stub().returns(word ? { word, startColumn: 1, endColumn: word.length + 1 } : null),
		getLanguageId: () => languageId,
	};
	return {
		getEditorType: () => EditorType.ICodeEditor,
		getModel: () => (hasModel ? model : null),
		getPosition: () => (hasPosition ? new Position(1, 1) : null),
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
} as unknown as IPositronVariablesInstance);

suite('PositronDataExplorerViewDataFrameAtCursorAction', () => {
	suite('metadata', () => {
		createTestContainer().build();

		test('registers with the expected id, f1, and editor context menu', () => {
			const action = new PositronDataExplorerViewDataFrameAtCursorAction();
			assert.strictEqual(action.desc.id, VIEW_DATA_FRAME_AT_CURSOR_ACTION_ID);
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
		let variablesInstances: IPositronVariablesInstance[];
		let existingViewerInstance: { requestFocus: sinon.SinonStub } | undefined;
		let notificationInfo: sinon.SinonStub;
		let notificationError: sinon.SinonStub;

		const ctx = createTestContainer()
			.stub(IEditorService, {
				get activeTextEditorControl() { return activeEditor; },
			} as Partial<IEditorService>)
			.stub(IRuntimeSessionService, {
				getConsoleSessionForLanguage: () => session,
			} as Partial<IRuntimeSessionService>)
			.stub(IPositronVariablesService, {
				get positronVariablesInstances() { return variablesInstances; },
			} as Partial<IPositronVariablesService>)
			.stub(IPositronDataExplorerService, {
				getInstanceForVar: () => existingViewerInstance as unknown as IPositronDataExplorerInstance | undefined,
				getInstanceForVariablePath: () => undefined,
				setInstanceForVar: sinon.stub(),
			} as Partial<IPositronDataExplorerService>)
			.stub(INotificationService, {
				info: (...args: any[]) => notificationInfo(...args),
				error: (...args: any[]) => notificationError(...args),
			} as Partial<INotificationService>)
			.build();

		setup(() => {
			activeEditor = undefined;
			session = undefined;
			variablesInstances = [];
			existingViewerInstance = undefined;
			notificationInfo = sinon.stub();
			notificationError = sinon.stub();
		});

		const runAction = () => {
			const action = new PositronDataExplorerViewDataFrameAtCursorAction();
			return ctx.instantiationService.invokeFunction(accessor => action.run(accessor));
		};

		test('is a no-op when no code editor is active', async () => {
			activeEditor = undefined;

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 0);
			assert.strictEqual(notificationError.callCount, 0);
		});

		test('is a no-op when the active editor has no model', async () => {
			activeEditor = makeCodeEditor({ hasModel: false });

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 0);
		});

		test('is a no-op when the active editor has no cursor position', async () => {
			activeEditor = makeCodeEditor({ hasPosition: false });

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 0);
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

		test('notifies with "Python" when no Python session is active', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'python' });
			session = undefined;

			await runAction();

			assert.match(notificationInfo.firstCall.args[0], /No active Python session/);
		});

		test('notifies when the Variables pane has not initialized for the session', async () => {
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [];

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /Open the Variables pane/);
		});

		test('notifies when the symbol is not defined in the session', async () => {
			activeEditor = makeCodeEditor({ word: 'missing', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [makeVariablesInstance([makeVariableItem({ displayName: 'df' })])];

			await runAction();

			assert.strictEqual(notificationInfo.callCount, 1);
			assert.match(notificationInfo.firstCall.args[0], /'missing' is not defined/);
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

		test('focuses an existing viewer when one is already open for the variable', async () => {
			const viewStub = sinon.stub().resolves(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [makeVariablesInstance([item])];
			existingViewerInstance = { requestFocus: sinon.stub() };

			await runAction();

			assert.strictEqual(existingViewerInstance.requestFocus.callCount, 1);
			assert.strictEqual(viewStub.callCount, 0);
			assert.strictEqual(notificationInfo.callCount, 0);
		});

		test('calls item.view() on the happy path when no viewer is open yet', async () => {
			const viewStub = sinon.stub().resolves(undefined);
			const item = makeVariableItem({ displayName: 'df', view: viewStub as unknown as IVariableItem['view'] });
			activeEditor = makeCodeEditor({ word: 'df', languageId: 'r' });
			session = makeSession('r');
			variablesInstances = [makeVariablesInstance([item])];

			await runAction();

			assert.strictEqual(viewStub.callCount, 1);
			assert.strictEqual(notificationInfo.callCount, 0);
		});
	});
});
