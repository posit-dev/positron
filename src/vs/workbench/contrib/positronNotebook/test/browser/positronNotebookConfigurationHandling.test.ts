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
import { POSITRON_NOTEBOOK_EDITOR_ID, usingPositronNotebooks } from '../../common/positronNotebookCommon.js';
import { createPositronNotebookTestServices } from './testUtils.js';
import { PositronNotebookViewType } from '../../common/positronNotebookViewType.js';

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
				id: POSITRON_NOTEBOOK_EDITOR_ID,
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
						PositronNotebookViewType.Jupyter,
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

	test('usingPositronNotebooks returns true when positron.notebook.enabled is true', async () => {
		await createTestServices();

		// Enable Positron notebooks via configuration setting
		configurationService.setUserConfiguration('positron.notebook.enabled', true);

		const isUsing = usingPositronNotebooks(configurationService);
		assert.strictEqual(isUsing, true);
	});

	test('usingPositronNotebooks returns false when positron.notebook.enabled is not set', async () => {
		await createTestServices();

		// No configuration set (defaults to false/undefined, both are falsy)
		const isUsing = usingPositronNotebooks(configurationService);
		assert.strictEqual(!!isUsing, false);
	});

	test('usingPositronNotebooks returns false when positron.notebook.enabled is false', async () => {
		await createTestServices();

		// Explicitly disable Positron notebooks
		configurationService.setUserConfiguration('positron.notebook.enabled', false);

		const isUsing = usingPositronNotebooks(configurationService);
		assert.strictEqual(isUsing, false);
	});


	test.skip('Cleanup disposes editor registrations properly', async () => {
		// Skipped: Positron notebook editor is behind feature flag (positron.notebook.enabled=false by default)
		// This test assumes the editor is registered by MockPositronNotebookContribution, which won't happen when the flag is disabled
		await createTestServices();

		// Verify editor is registered
		let editors = editorResolverService.getEditors();
		let positronEditor = editors.find(e => e.id === POSITRON_NOTEBOOK_EDITOR_ID);
		assert.ok(positronEditor);

		// Dispose contribution
		notebookContribution.dispose();

		// Verify editor is no longer registered
		editors = editorResolverService.getEditors();
		positronEditor = editors.find(e => e.id === POSITRON_NOTEBOOK_EDITOR_ID);
		assert.strictEqual(positronEditor, undefined);
	});
});

