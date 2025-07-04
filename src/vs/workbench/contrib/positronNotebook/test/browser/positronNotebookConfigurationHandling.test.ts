/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService, IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../services/editor/common/editorResolverService.js';
import { ITestInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { Event } from '../../../../../base/common/event.js';
import { PositronNotebookEditorInput } from '../../browser/PositronNotebookEditorInput.js';
import { POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, getPreferredNotebookEditor } from '../../browser/positronNotebook.contribution.js';
import { createPositronNotebookTestServices } from './testUtils.js';

// Mock implementation for testing configuration-driven editor registration
class MockPositronNotebookContribution extends DisposableStore {
	private _currentRegistration: any;
	private _registrationCount = 0;

	constructor(
		private editorResolverService: IEditorResolverService,
		private configurationService: IConfigurationService,
		private instantiationService: ITestInstantiationService
	) {
		super();
		this.registerEditor();
		this.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY)) {
				this.registerEditor();
			}
		}));
	}

	private registerEditor(): void {
		// Dispose existing registration
		this._currentRegistration?.dispose();
		this._registrationCount++;

		// Register with current priority
		this._currentRegistration = this.editorResolverService.registerEditor(
			'*.ipynb',
			{
				id: PositronNotebookEditorInput.EditorID,
				label: 'Positron Notebook',
				priority: this.getEditorPriority()
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

	private getEditorPriority(): RegisteredEditorPriority {
		const defaultEditor = getPreferredNotebookEditor(this.configurationService);
		return defaultEditor === 'positron'
			? RegisteredEditorPriority.default
			: RegisteredEditorPriority.option;
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
			configurationService,
			instantiationService
		);
		disposables.add(notebookContribution);
	}

	test('Editor re-registration occurs when configuration changes', async () => {
		await createTestServices();

		const initialRegistrationCount = notebookContribution.registrationCount;

		// Change configuration
		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, 'positron');

		// Trigger configuration change event
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: (key: string) => key === POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY,
			source: 6, // ConfigurationTarget.USER
			affectedKeys: new Set([POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY]),
			change: { keys: [POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY], overrides: [] }
		} as IConfigurationChangeEvent);

		// Should have triggered a new registration
		assert.strictEqual(notebookContribution.registrationCount, initialRegistrationCount + 1);
	});

	test('Editor priority changes correctly with configuration', async () => {
		await createTestServices();

		// Start with vscode (option priority)
		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, 'vscode');
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: (key: string) => key === POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY,
			source: 6,
			affectedKeys: new Set([POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY]),
			change: { keys: [POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY], overrides: [] }
		} as IConfigurationChangeEvent);

		let editors = editorResolverService.getEditors();
		let positronEditor = editors.find(e => e.id === PositronNotebookEditorInput.EditorID);
		assert.ok(positronEditor);
		assert.strictEqual(positronEditor.priority, RegisteredEditorPriority.option);

		// Change to positron (default priority)
		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, 'positron');
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: (key: string) => key === POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY,
			source: 6,
			affectedKeys: new Set([POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY]),
			change: { keys: [POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY], overrides: [] }
		} as IConfigurationChangeEvent);

		editors = editorResolverService.getEditors();
		positronEditor = editors.find(e => e.id === PositronNotebookEditorInput.EditorID);
		assert.ok(positronEditor);
		assert.strictEqual(positronEditor.priority, RegisteredEditorPriority.default);
	});

	test('Configuration changes not affecting notebook setting do not trigger re-registration', async () => {
		await createTestServices();

		const initialRegistrationCount = notebookContribution.registrationCount;

		// Change unrelated configuration
		configurationService.setUserConfiguration('workbench.editor.enablePreview', false);
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: (key: string) => key === 'workbench.editor.enablePreview',
			source: 6,
			affectedKeys: new Set(['workbench.editor.enablePreview']),
			change: { keys: ['workbench.editor.enablePreview'], overrides: [] }
		} as IConfigurationChangeEvent);

		// Should not have triggered a new registration
		assert.strictEqual(notebookContribution.registrationCount, initialRegistrationCount);
	});

	test('Handles null/undefined configuration values gracefully', async () => {
		await createTestServices();

		// Set configuration to null/undefined
		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, null);

		// Should default to 'vscode'
		const preferred = getPreferredNotebookEditor(configurationService);
		assert.strictEqual(preferred, 'vscode');

		// Verify editor is registered with option priority
		const editors = editorResolverService.getEditors();
		const positronEditor = editors.find(e => e.id === PositronNotebookEditorInput.EditorID);
		assert.ok(positronEditor);
		assert.strictEqual(positronEditor.priority, RegisteredEditorPriority.option);
	});

	test('Handles configuration service returning undefined', async () => {
		await createTestServices();

		// Create a configuration service that returns undefined
		const emptyConfigService = {
			getValue: () => undefined,
			onDidChangeConfiguration: Event.None
		} as any;

		const preferred = getPreferredNotebookEditor(emptyConfigService);
		assert.strictEqual(preferred, 'vscode');
	});


	test('Cleanup disposes editor registrations properly', async () => {
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

