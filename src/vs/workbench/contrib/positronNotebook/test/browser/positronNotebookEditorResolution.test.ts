/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @fileoverview Tests for Positron Notebook editor resolution logic.
 *
 * This test suite verifies that the Positron Notebook editor correctly resolves and handles
 * file types based on user configuration. These tests are critical for ensuring that:
 *
 * 1. **File Type Specificity**: Only .ipynb files are handled by the Positron Notebook editor,
 *    while other file types (like .py, .js, etc.) are properly delegated to their appropriate editors.
 *
 * 2. **Configuration Defaults**: The system gracefully handles missing or invalid configuration
 *    values by falling back to sensible defaults (VS Code's default notebook editor).
 *
 * 3. **Editor Priority Resolution**: The editor resolver service correctly prioritizes and
 *    instantiates the appropriate editor based on file type and user preferences.
 *
 * **Context**: This is part of Positron Notebooks 2.0's transition from intercepting/hijacking
 * the existing NotebookEditor to registering as a separate editor that receives priority for
 * .ipynb files. This approach eliminates the previous "hijacking" behavior and allows users
 * to opt out without modifying global settings.
 *
 * **Why These Tests Matter**: Unlike end-to-end tests that verify user-facing behavior, these
 * unit tests focus on the internal resolution mechanics that are difficult to test at higher
 * levels, including error conditions, edge cases, and proper resource cleanup.
 *
 * @see {@link PositronNotebookEditorInput} - The editor input class being tested
 * @see {@link getPreferredNotebookEditor} - Configuration utility function
 * @see {@link EditorResolverService} - Core service for editor resolution
 */

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { RegisteredEditorPriority, ResolvedStatus } from '../../../../services/editor/common/editorResolverService.js';
import { ITestInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { EditorPart } from '../../../../browser/parts/editor/editorPart.js';
import { PositronNotebookEditorInput } from '../../browser/PositronNotebookEditorInput.js';
import { POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, getPreferredNotebookEditor } from '../../browser/positronNotebook.contribution.js';
import { createPositronNotebookTestServices } from './testUtils.js';

suite('Positron Notebook Editor Resolution', () => {

	const disposables = new DisposableStore();
	let instantiationService: ITestInstantiationService;
	let configurationService: TestConfigurationService;
	let editorResolverService: EditorResolverService;
	let part: EditorPart;

	teardown(() => disposables.clear());

	ensureNoDisposablesAreLeakedInTestSuite();

	async function createTestServices(): Promise<void> {
		const services = await createPositronNotebookTestServices(disposables);
		instantiationService = services.instantiationService;
		configurationService = services.configurationService;
		editorResolverService = services.editorResolverService;
		part = services.part;
	}

	function registerPositronNotebookEditor(priority: RegisteredEditorPriority): void {
		const registration = editorResolverService.registerEditor(
			'*.ipynb',
			{
				id: PositronNotebookEditorInput.EditorID,
				label: 'Positron Notebook',
				priority: priority
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
						instantiationService,
						resource,
						undefined,
						'jupyter-notebook',
						{ startDirty: false }
					);
					return { editor: editorInput };
				}
			}
		);
		disposables.add(registration);
	}


	test('getPreferredNotebookEditor defaults to vscode when no setting', async () => {
		await createTestServices();

		const preferred = getPreferredNotebookEditor(configurationService);
		assert.strictEqual(preferred, 'vscode');
	});


	test('Invalid configuration value defaults to vscode', async () => {
		await createTestServices();

		// Set invalid value
		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, 'invalid-value');

		const preferred = getPreferredNotebookEditor(configurationService);
		assert.strictEqual(preferred, 'vscode');
	});

	test('Only ipynb files are handled by Positron notebook editor', async () => {
		await createTestServices();

		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY, 'positron');
		registerPositronNotebookEditor(RegisteredEditorPriority.default);

		// Test .ipynb file - should resolve
		const ipynbResult = await editorResolverService.resolveEditor(
			{ resource: URI.file('/test/notebook.ipynb') },
			part.activeGroup
		);

		assert.ok(ipynbResult);
		assert.notStrictEqual(typeof ipynbResult, 'number');
		if (ipynbResult !== ResolvedStatus.ABORT && ipynbResult !== ResolvedStatus.NONE) {
			assert.strictEqual(ipynbResult.editor.typeId, PositronNotebookEditorInput.ID);
			// Ensure proper cleanup of the editor and its internal components
			if (ipynbResult.editor instanceof PositronNotebookEditorInput) {
				ipynbResult.editor.notebookInstance?.dispose();
			}
			ipynbResult.editor.dispose();
		}

		// Test .py file - should not resolve to Positron notebook
		const pyResult = await editorResolverService.resolveEditor(
			{ resource: URI.file('/test/script.py') },
			part.activeGroup
		);

		// Should resolve but not to Positron notebook editor
		if (pyResult !== ResolvedStatus.ABORT && pyResult !== ResolvedStatus.NONE && typeof pyResult !== 'number') {
			assert.notStrictEqual(pyResult.editor.typeId, PositronNotebookEditorInput.ID);
			pyResult.editor.dispose();
		}
	});
});
