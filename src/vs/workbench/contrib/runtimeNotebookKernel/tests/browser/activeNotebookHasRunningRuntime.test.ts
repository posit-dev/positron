/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { TextResourceEditorInput } from '../../../../common/editor/textResourceEditorInput.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { TestEditorInput, TestEditorService } from '../../../../test/browser/workbenchTestServices.js';
import { NotebookEditorInput } from '../../../notebook/common/notebookEditorInput.js';
import { ActiveNotebookHasRunningRuntimeManager } from '../../common/activeNotebookHasRunningRuntime.js';

/** A TestEditorService that fires the onDidActiveEditorChange event when changing the activeEditor. */
class TestEditorService2 extends TestEditorService {
	private readonly _onDidActiveEditorChange = this._register(new Emitter<void>());

	public override onDidActiveEditorChange = this._onDidActiveEditorChange.event;

	public override get activeEditor(): EditorInput | undefined {
		return super.activeEditor;
	}

	public override set activeEditor(value: EditorInput | undefined) {
		super.activeEditor = value;
		this._onDidActiveEditorChange.fire();
	}
}

suite('ActiveNotebookHasRunningRuntimeManager', () => {
	const notebookUri = URI.file('notebook.ipynb');
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let editorService: TestEditorService2;
	let instantiationService: TestInstantiationService;
	let notebookEditorInput: TestEditorInput;
	let runtimeSessionService: IRuntimeSessionService;
	let textEditorInput: TestEditorInput;
	let manager: ActiveNotebookHasRunningRuntimeManager;

	setup(() => {
		editorService = disposables.add(new TestEditorService2());
		instantiationService = positronWorkbenchInstantiationService(disposables, {
			editorService: () => editorService,
		});
		notebookEditorInput = disposables.add(new TestEditorInput(notebookUri, NotebookEditorInput.ID));
		runtimeSessionService = instantiationService.get(IRuntimeSessionService);
		textEditorInput = disposables.add(new TestEditorInput(notebookUri, TextResourceEditorInput.ID));
		manager = disposables.add(instantiationService.createInstance(ActiveNotebookHasRunningRuntimeManager));
	});

	function startNotebookSession() {
		return startTestLanguageRuntimeSession(instantiationService, disposables, {
			notebookUri,
			sessionMode: LanguageRuntimeSessionMode.Notebook,
		});
	}

	function assertContextEqual(expected: boolean) {
		assert.strictEqual(manager.context.get(), expected);
	}

	test('context is initially disabled', () => {
		assertContextEqual(false);
	});

	test('starting a session without an active notebook disables the context', async () => {
		await startNotebookSession();

		assertContextEqual(false);
	});

	test('showing a notebook without a running session disables the context', async () => {
		editorService.activeEditor = notebookEditorInput;

		assertContextEqual(false);
	});

	test('showing a text file with a running session disables the context', async () => {
		await startNotebookSession();

		editorService.activeEditor = textEditorInput;

		assertContextEqual(false);
	});

	test('showing a notebook with a running session enables the context', async () => {
		await startNotebookSession();

		editorService.activeEditor = notebookEditorInput;

		assertContextEqual(true);
	});

	test('starting a session for the active notebook enables the context', async () => {
		editorService.activeEditor = notebookEditorInput;

		await startNotebookSession();

		assertContextEqual(true);
	});

	test('restarting a session for the active notebook disables then enables the context', async () => {
		const session = await startNotebookSession();
		editorService.activeEditor = notebookEditorInput;

		let contextAtSessionEnd: boolean | undefined;
		disposables.add(session.onDidEndSession(() => {
			contextAtSessionEnd = manager.context.get();
		}));

		await waitForRuntimeState(session, RuntimeState.Ready);
		await runtimeSessionService.restartSession(session.metadata.sessionId, 'User ran restart notebook command');

		assert.strictEqual(contextAtSessionEnd, false);
		assertContextEqual(true);
	});
});
