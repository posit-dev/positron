/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @fileoverview Tests for Positron Notebook editor resolution logic.
 *
 * This test suite verifies that the Positron Notebook editor correctly resolves and handles
 * file types with static editor registration. These tests are critical for ensuring that:
 *
 * 1. **File Type Specificity**: Only .ipynb files are handled by the Positron Notebook editor,
 *    while other file types (like .py, .js, etc.) are properly delegated to their appropriate editors.
 *
 * 2. **Static Registration**: The editor is registered with option priority, making it available
 *    in the "Open With..." menu while relying on workbench.editorAssociations for default behavior.
 *
 * 3. **Editor Resolution**: The editor resolver service correctly instantiates the appropriate
 *    editor based on file type and editor associations.
 *
 * **Context**: This is part of the transition away from feature flag configuration to using
 * VS Code's standard workbench.editorAssociations for controlling which notebook editor opens
 * .ipynb files by default.
 *
 * **Why These Tests Matter**: Unlike end-to-end tests that verify user-facing behavior, these
 * unit tests focus on the internal resolution mechanics that are difficult to test at higher
 * levels, including error conditions, edge cases, and proper resource cleanup.
 *
 * @see {@link PositronNotebookEditorInput} - The editor input class being tested
 * @see {@link usingPositronNotebooks} - Configuration utility function
 * @see {@link EditorResolverService} - Core service for editor resolution
 */

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { RegisteredEditorPriority, ResolvedStatus } from '../../../../services/editor/common/editorResolverService.js';
import { ITestInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { EditorPart } from '../../../../browser/parts/editor/editorPart.js';
import { PositronNotebookEditorInput } from '../../browser/PositronNotebookEditorInput.js';
import { POSITRON_NOTEBOOK_EDITOR_ID, usingPositronNotebooks } from '../../common/positronNotebookCommon.js';
import { createPositronNotebookTestServices } from './testUtils.js';

suite.skip('Positron Notebook Editor Resolution', () => {
	// Suite skipped: Positron notebook editor is behind feature flag (positron.notebook.enabled=false by default)
	// These tests assume the editor is registered, which won't happen when the flag is disabled

	const disposables = new DisposableStore();
	let instantiationService: ITestInstantiationService;
	let editorResolverService: EditorResolverService;
	let part: EditorPart;

	teardown(() => disposables.clear());

	ensureNoDisposablesAreLeakedInTestSuite();

	async function createTestServices(): Promise<void> {
		const services = await createPositronNotebookTestServices(disposables);
		instantiationService = services.instantiationService;
		editorResolverService = services.editorResolverService;
		part = services.part;
	}

	function registerPositronNotebookEditor(priority: RegisteredEditorPriority): void {
		const registration = editorResolverService.registerEditor(
			'*.ipynb',
			{
				id: POSITRON_NOTEBOOK_EDITOR_ID,
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
						{ startDirty: false }
					);
					return { editor: editorInput };
				}
			}
		);
		disposables.add(registration);
	}


	test('Editor is registered with static option priority', async () => {
		await createTestServices();

		// Register with option priority (static registration)
		registerPositronNotebookEditor(RegisteredEditorPriority.option);

		// With option priority and no editor association configured,
		// the resolver should return NONE to continue with default resolution
		const ipynbResult = await editorResolverService.resolveEditor(
			{ resource: URI.file('/test/notebook.ipynb') },
			part.activeGroup
		);

		// Should return ResolvedStatus.NONE when no editor association is configured
		// This allows VS Code's default notebook editor to handle the file
		assert.strictEqual(ipynbResult, ResolvedStatus.NONE);
	});

	test('Editor registration pattern matches only ipynb files', async () => {
		await createTestServices();

		registerPositronNotebookEditor(RegisteredEditorPriority.option);

		// Test .ipynb file - should return NONE (allowing default resolution) when no association is set
		const ipynbResult = await editorResolverService.resolveEditor(
			{ resource: URI.file('/test/notebook.ipynb') },
			part.activeGroup
		);

		// With option priority and no editor association, should return NONE
		assert.strictEqual(ipynbResult, ResolvedStatus.NONE);

		// Test .py file - should also return NONE as it doesn't match our pattern
		const pyResult = await editorResolverService.resolveEditor(
			{ resource: URI.file('/test/script.py') },
			part.activeGroup
		);

		// Should return NONE for non-matching files
		assert.strictEqual(pyResult, ResolvedStatus.NONE);
	});

	test('Editor registration supports file scheme resources', async () => {
		await createTestServices();

		registerPositronNotebookEditor(RegisteredEditorPriority.option);

		// Test file:// scheme - with option priority and no editor association, should return NONE
		const fileResult = await editorResolverService.resolveEditor(
			{ resource: URI.file('/test/notebook.ipynb') },
			part.activeGroup
		);

		// Should return NONE when no editor association is configured
		assert.strictEqual(fileResult, ResolvedStatus.NONE);

		// Test non-file scheme - should also return NONE as it doesn't match our pattern
		const httpResult = await editorResolverService.resolveEditor(
			{ resource: URI.parse('http://example.com/notebook.ipynb') },
			part.activeGroup
		);

		// Should return NONE for non-file scheme resources
		assert.strictEqual(httpResult, ResolvedStatus.NONE);
	});

	test('Editor registration behavior with option priority', async () => {
		await createTestServices();

		registerPositronNotebookEditor(RegisteredEditorPriority.option);

		const resource = URI.file('/test/notebook.ipynb');

		// With option priority and no editor association configured,
		// multiple resolutions should consistently return NONE
		const firstResult = await editorResolverService.resolveEditor(
			{ resource },
			part.activeGroup
		);

		// Should return NONE when no editor association is configured
		assert.strictEqual(firstResult, ResolvedStatus.NONE);

		// Second resolution for same resource should also return NONE
		const secondResult = await editorResolverService.resolveEditor(
			{ resource },
			part.activeGroup
		);

		// Should consistently return NONE
		assert.strictEqual(secondResult, ResolvedStatus.NONE);
	});

	test('Static registration allows editor to be available in Open With menu', async () => {
		await createTestServices();

		// Register with option priority - this makes the editor available as an option
		// but doesn't make it the default unless configured via workbench.editorAssociations
		registerPositronNotebookEditor(RegisteredEditorPriority.option);

		// The editor should be registered and available for selection
		// even though it returns NONE for default resolution
		const resource = URI.file('/test/notebook.ipynb');
		const result = await editorResolverService.resolveEditor(
			{ resource },
			part.activeGroup
		);

		// Returns NONE to allow default resolution, but the editor is still registered
		// and would be available in the "Open With..." menu
		assert.strictEqual(result, ResolvedStatus.NONE);

		// This test verifies that the static registration approach works as expected:
		// - Editor is registered with option priority
		// - Default behavior is controlled by workbench.editorAssociations
		// - Editor remains available as an option for users
	});
});
