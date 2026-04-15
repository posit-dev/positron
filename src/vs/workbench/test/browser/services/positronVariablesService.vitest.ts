/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { NotebookTextModel } from '../../../contrib/notebook/common/model/notebookTextModel.js';
import { INotebookEditor } from '../../../contrib/notebook/browser/notebookBrowser.js';
import { INotebookEditorService } from '../../../contrib/notebook/browser/services/notebookEditorService.js';
import { LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { startTestLanguageRuntimeSession } from '../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor } from '../positronWorkbenchTestServices.js';
import { createTestContainer } from '../positronTestContainer.js';

interface TestNotebookEditor extends INotebookEditor {
	changeModel(uri: URI): void;
}

describe('Positron - PositronVariablesService', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	let variablesService: IPositronVariablesService;
	let notebookEditorService: INotebookEditorService;


	beforeEach(() => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		variablesService = accessor.positronVariablesService;
		notebookEditorService = accessor.notebookEditorService;

		// Set the view as visible so that variables instances are created
		variablesService.setViewVisible(true);
	});

	async function createNotebookInstance() {
		const notebookUri = URI.file('test-notebook.ipynb');

		// Add a mock notebook editor
		const onDidChangeModel = ctx.disposables.add(new Emitter<NotebookTextModel | undefined>());
		const notebookEditor = <TestNotebookEditor>{
			getId() { return 'test-notebook-editor-id'; },
			onDidChangeModel: onDidChangeModel.event,
			textModel: { uri: notebookUri },
			changeModel(uri) { onDidChangeModel.fire(<NotebookTextModel>{ uri }); },
		};
		notebookEditorService.addNotebookEditor(notebookEditor);

		// Start a notebook session
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
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
			ctx.instantiationService,
			ctx.disposables,
			{
				sessionMode: LanguageRuntimeSessionMode.Console
			}
		);

		return { session };
	}

	it('should initialize with no active session', async () => {
		expect(variablesService.activePositronVariablesInstance).toBe(undefined);
	});

	it('should create variables instance for new sessions', async () => {
		const { session: notebookSession } = await createNotebookInstance();
		const { session: consoleSession } = await createConsoleInstance();
		await timeout(0);

		// Both sessions should have variables instances
		expect(variablesService.positronVariablesInstances.some(instance =>
			instance.session.sessionId === notebookSession.sessionId)).toBeTruthy();
		expect(variablesService.positronVariablesInstances.some(instance =>
			instance.session.sessionId === consoleSession.sessionId)).toBeTruthy();
	});

	it('should dispose all instances when view becomes hidden', async () => {
		// Create sessions while view is visible
		const { session: notebookSession } = await createNotebookInstance();
		const { session: consoleSession } = await createConsoleInstance();
		await timeout(0);

		// Verify instances exist
		expect(variablesService.positronVariablesInstances.length).toBe(2);
		expect(variablesService.positronVariablesInstances.some(instance =>
			instance.session.sessionId === notebookSession.sessionId)).toBeTruthy();
		expect(variablesService.positronVariablesInstances.some(instance =>
			instance.session.sessionId === consoleSession.sessionId)).toBeTruthy();

		// Hide the view
		variablesService.setViewVisible(false);
		await timeout(0);

		// All instances should be disposed
		expect(variablesService.positronVariablesInstances.length).toBe(0);
		expect(variablesService.activePositronVariablesInstance).toBe(undefined);
	});

	it('should recreate instances when view becomes visible again', async () => {
		// Create a session while view is visible
		const { session: consoleSession } = await createConsoleInstance();
		await timeout(0);

		// Verify instance exists
		expect(variablesService.positronVariablesInstances.length).toBe(1);

		// Hide the view - instances should be disposed
		variablesService.setViewVisible(false);
		await timeout(0);
		expect(variablesService.positronVariablesInstances.length).toBe(0);

		// Show the view again - instances should be recreated for active sessions
		variablesService.setViewVisible(true);
		await timeout(0);

		// Instance should be recreated for the existing session
		expect(variablesService.positronVariablesInstances.length).toBe(1);
		expect(variablesService.positronVariablesInstances.some(instance =>
			instance.session.sessionId === consoleSession.sessionId)).toBeTruthy();
	});

});
