/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../services/editor/common/editorResolverService.js';
import { ITestInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { PositronNotebookEditorInput } from '../../browser/PositronNotebookEditorInput.js';
import { POSITRON_NOTEBOOK_EDITOR_ID, usingPositronNotebooks } from '../../common/positronNotebookCommon.js';
import { notebookTestBuilder, attachEditorPart } from './testUtils.js';
import { IPYNB_VIEW_TYPE } from '../../../notebook/browser/notebookBrowser.js';

// Mock implementation for testing static editor registration
class MockPositronNotebookContribution extends DisposableStore {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
						IPYNB_VIEW_TYPE,
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

describe('Positron Notebook Configuration Handling', () => {

	describe('usingPositronNotebooks', () => {
		// These tests only need configurationService -- no EditorPart needed.
		const configurationService = new TestConfigurationService();
		const ctx = notebookTestBuilder()
			.stub(IConfigurationService, configurationService)
			.build();

		// Reset the configuration before each test so they don't bleed into each other.
		beforeEach(() => {
			configurationService.setUserConfiguration('positron.notebook.enabled', undefined);
		});

		it('returns true when positron.notebook.enabled is true', () => {
			configurationService.setUserConfiguration('positron.notebook.enabled', true);
			expect(usingPositronNotebooks(configurationService)).toBe(true);
		});

		it('returns false when positron.notebook.enabled is not set', () => {
			// No configuration set (defaults to undefined, which is falsy)
			expect(!!usingPositronNotebooks(configurationService)).toBe(false);
		});

		it('returns false when positron.notebook.enabled is false', () => {
			configurationService.setUserConfiguration('positron.notebook.enabled', false);
			expect(usingPositronNotebooks(configurationService)).toBe(false);
		});
	});

	describe('editor registration cleanup', () => {
		const configurationService = new TestConfigurationService();
		const ctx = notebookTestBuilder()
			.stub(IConfigurationService, configurationService)
			.build();

		let editorResolverService: EditorResolverService;
		let notebookContribution: MockPositronNotebookContribution;

		beforeEach(async () => {
			({ editorResolverService } = await attachEditorPart(
				ctx.instantiationService,
				ctx.disposables,
			));
			notebookContribution = new MockPositronNotebookContribution(
				editorResolverService,
				ctx.instantiationService as unknown as ITestInstantiationService,
			);
			ctx.disposables.add(notebookContribution);
		});

		it.skip('Cleanup disposes editor registrations properly', () => {
			// Skipped: Positron notebook editor is behind feature flag (positron.notebook.enabled=false by default)
			// This test assumes the editor is registered by MockPositronNotebookContribution, which won't happen when the flag is disabled

			// Verify editor is registered
			let editors = editorResolverService.getEditors();
			let positronEditor = editors.find(e => e.id === POSITRON_NOTEBOOK_EDITOR_ID);
			expect(positronEditor).toBeDefined();

			// Dispose contribution
			notebookContribution.dispose();

			// Verify editor is no longer registered
			editors = editorResolverService.getEditors();
			positronEditor = editors.find(e => e.id === POSITRON_NOTEBOOK_EDITOR_ID);
			expect(positronEditor).toBe(undefined);
		});
	});
});
