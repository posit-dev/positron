/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorService';
import { LanguageRuntimeSessionMode } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronVariablesService } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesService';
import { startTestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService } from 'vs/workbench/test/browser/positronWorkbenchTestServices';

interface TestNotebookEditor extends INotebookEditor {
	changeModel(uri: URI): void;
}

suite('Positron - PositronVariablesService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let accessor: PositronTestServiceAccessor;
	let variablesService: IPositronVariablesService;
	let notebookEditorService: INotebookEditorService;


	setup(() => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		accessor = instantiationService.createInstance(PositronTestServiceAccessor);
		variablesService = accessor.positronVariablesService;
		notebookEditorService = accessor.notebookEditorService;
	});

	async function createNotebookInstance() {
		const notebookUri = URI.file('test-notebook.ipynb');

		// Add a mock notebook editor
		const onDidChangeModel = disposables.add(new Emitter<NotebookTextModel | undefined>());
		const notebookEditor = <TestNotebookEditor>{
			getId() { return 'test-notebook-editor-id'; },
			onDidChangeModel: onDidChangeModel.event,
			textModel: { uri: notebookUri },
			changeModel(uri) { onDidChangeModel.fire(<NotebookTextModel>{ uri }); },
		};
		notebookEditorService.addNotebookEditor(notebookEditor);

		// Start a notebook session
		const session = await startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				notebookUri
			}
		);

		return {
			notebookUri,
			notebookEditor,
			session
		};
	}

	async function createConsoleInstance() {
		// Start a console session
		const session = await startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				sessionMode: LanguageRuntimeSessionMode.Console
			}
		);

		return { session };
	}

	test('should initialize with no active session', async () => {
		assert.strictEqual(variablesService.activePositronVariablesInstance, undefined);
	});

	test('should create variables instance for new sessions', async () => {
		const { session: notebookSession } = await createNotebookInstance();
		const { session: consoleSession } = await createConsoleInstance();
		await timeout(0);

		// Both sessions should have variables instances
		assert(variablesService.positronVariablesInstances.some(instance =>
			instance.session.sessionId === notebookSession.sessionId));
		assert(variablesService.positronVariablesInstances.some(instance =>
			instance.session.sessionId === consoleSession.sessionId));
	});

});
