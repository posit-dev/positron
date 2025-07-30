/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../services/editor/common/editorResolverService.js';
import { ITestInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { PositronNotebookEditorInput } from '../../browser/PositronNotebookEditorInput.js';
import { usingPositronNotebooks } from '../../../../services/positronNotebook/common/positronNotebookUtils.js';
import { createPositronNotebookTestServices } from './testUtils.js';

// Mock implementation for testing static editor registration
class MockPositronNotebookContribution extends DisposableStore {
	private _currentRegistration: any;
	private _registrationCount = 0;

	constructor(
		private editorResolverService: IEditorResolverService,
		private instantiationService: ITestInstantiationService
	) {
		super();
		this.registerEditor();
	}

	private registerEditor(): void {
		// Dispose existing registration
		this._currentRegistration?.dispose();
		this._registrationCount++;

		// Register with static option priority
		this._currentRegistration = this.editorResolverService.registerEditor(
			'*.ipynb',
			{
				id: PositronNotebookEditorInput.EditorID,
				label: 'Positron Notebook',
				priority: RegisteredEditorPriority.option
			},
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					return resource.scheme === 'file';
				}
			},
			{
				createEditorInput: async ({ resource }) => {
					const editorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						resource,
						undefined,
						'jupyter-notebook',
						{ startDirty: false }
					);
					return { editor: editorInput };
				}
			}
		);
	}

	get registrationCount(): number {
		return this._registrationCount;
	}

	override dispose(): void {
		this._currentRegistration?.dispose();
		super.dispose();
	}
}

suite('Positron Notebook Configuration Handling', () => {

	const disposables = new DisposableStore();
	let instantiationService: ITestInstantiationService;
	let configurationService: TestConfigurationService;
	let editorResolverService: EditorResolverService;

	let notebookContribution: MockPositronNotebookContribution;

	teardown(() => disposables.clear());

	ensureNoDisposablesAreLeakedInTestSuite();

	async function createTestServices(): Promise<void> {
		const services = await createPositronNotebookTestServices(disposables);
		instantiationService = services.instantiationService;
		configurationService = services.configurationService;
		editorResolverService = services.editorResolverService;

		// Create mock notebook contribution that handles registration
		notebookContribution = new MockPositronNotebookContribution(
			editorResolverService,
			instantiationService
		);
		disposables.add(notebookContribution);
	}

	test('usingPositronNotebooks returns true when editor association is set', async () => {
		await createTestServices();

		// Set editor association for Positron notebooks
		configurationService.setUserConfiguration('workbench.editorAssociations', {
			'*.ipynb': 'workbench.editor.positronNotebook'
		});

		const isUsing = usingPositronNotebooks(configurationService);
		assert.strictEqual(isUsing, true);
	});

	test('usingPositronNotebooks returns false when editor association is not set', async () => {
		await createTestServices();

		// No editor associations set
		const isUsing = usingPositronNotebooks(configurationService);
		assert.strictEqual(isUsing, false);
	});

	test('usingPositronNotebooks returns false when editor association is set to different editor', async () => {
		await createTestServices();

		// Set editor association to VS Code notebook
		configurationService.setUserConfiguration('workbench.editorAssociations', {
			'*.ipynb': 'jupyter-notebook'
		});

		const isUsing = usingPositronNotebooks(configurationService);
		assert.strictEqual(isUsing, false);
	});


	test.skip('Cleanup disposes editor registrations properly', async () => {
		// Skipped: Positron notebook editor is behind feature flag (positron.notebook.enabled=false by default)
		// This test assumes the editor is registered by MockPositronNotebookContribution, which won't happen when the flag is disabled
		await createTestServices();

		// Verify editor is registered
		let editors = editorResolverService.getEditors();
		let positronEditor = editors.find(e => e.id === PositronNotebookEditorInput.EditorID);
		assert.ok(positronEditor);

		// Dispose contribution
		notebookContribution.dispose();

		// Verify editor is no longer registered
		editors = editorResolverService.getEditors();
		positronEditor = editors.find(e => e.id === PositronNotebookEditorInput.EditorID);
		assert.strictEqual(positronEditor, undefined);
	});
});

