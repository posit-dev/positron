/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { IConstructorSignature } from '../../../platform/instantiation/common/instantiation.js';
import { DEFAULT_EDITOR_ASSOCIATION } from '../../common/editor.js';
import { EditorResolverService } from '../../services/editor/browser/editorResolverService.js';
import { IEditorGroupsService } from '../../services/editor/common/editorGroupsService.js';
import { editorsAssociationsSettingId, IEditorResolverService, RegisteredEditorPriority } from '../../services/editor/common/editorResolverService.js';
import { IPositronDataExplorerService } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronObjectExplorerService } from '../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';
import { PositronDataExplorerContribution } from '../../contrib/positronDataExplorerEditor/browser/positronDataExplorerEditor.contribution.js';
import { PositronDataExplorerEditorInput } from '../../contrib/positronDataExplorerEditor/browser/positronDataExplorerEditorInput.js';
import { PositronObjectExplorerContribution } from '../../contrib/positronObjectExplorerEditor/browser/positronObjectExplorerEditor.contribution.js';
import { PositronObjectExplorerEditorInput } from '../../contrib/positronObjectExplorerEditor/browser/positronObjectExplorerEditorInput.js';
import { PositronPlotsEditorContribution } from '../../contrib/positronPlotsEditor/browser/positronPlotsEditor.contribution.js';
import { PositronPlotsEditorInput } from '../../contrib/positronPlotsEditor/browser/positronPlotsEditorInput.js';
import { PositronPlotsGalleryEditorContribution } from '../../contrib/positronPlotsGalleryEditor/browser/positronPlotsGalleryEditor.contribution.js';
import { PositronPlotsGalleryEditorInput } from '../../contrib/positronPlotsGalleryEditor/browser/positronPlotsGalleryEditorInput.js';
import { PositronPreviewEditorContribution } from '../../contrib/positronPreviewEditor/browser/positronPreviewEditor.contribution.js';
import { PositronPreviewEditorInput } from '../../contrib/positronPreviewEditor/browser/positronPreviewEditorInput.js';
import { createTestContainer } from '../../../test/vitest/positronTestContainer.js';
import { createEditorPart, TestFileEditorInput } from './workbenchTestServices.js';

/**
 * Positron registers editors for internal URI schemes that no other editor can open. A user
 * editor association that matches those URIs (for example `"*": "default"`) must not send them
 * to another editor. See https://github.com/posit-dev/positron/issues/16942.
 */
describe('Positron internal editors with user editor associations', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IPositronDataExplorerService, {})
		.stub(IPositronObjectExplorerService, {})
		.build();

	/**
	 * Registers a contribution with a real editor resolver, configured with the given editor
	 * associations, and returns the resolver.
	 */
	async function createResolver(
		contribution: IConstructorSignature<{ dispose(): void }>,
		associations: Record<string, string>
	): Promise<EditorResolverService> {
		const instantiationService = ctx.instantiationService;
		instantiationService.stub(IConfigurationService, new TestConfigurationService({
			[editorsAssociationsSettingId]: associations
		}));
		const part = await createEditorPart(instantiationService, ctx.disposables);
		instantiationService.stub(IEditorGroupsService, part);
		const editorResolverService = ctx.disposables.add(instantiationService.createInstance(EditorResolverService));
		instantiationService.stub(IEditorResolverService, editorResolverService);

		// Stand-in for the default text editor that the text editor service registers for every resource.
		ctx.disposables.add(editorResolverService.registerEditor(
			'*',
			{
				id: DEFAULT_EDITOR_ASSOCIATION.id,
				label: DEFAULT_EDITOR_ASSOCIATION.displayName,
				priority: RegisteredEditorPriority.builtin
			},
			{},
			{ createEditorInput: ({ resource }) => ({ editor: new TestFileEditorInput(resource, 'test.defaultInput') }) }
		));

		ctx.disposables.add(instantiationService.createInstance(contribution));
		return editorResolverService;
	}

	it.each([
		{ name: 'Data Explorer', contribution: PositronDataExplorerContribution, scheme: Schemas.positronDataExplorer, editorId: PositronDataExplorerEditorInput.EditorID },
		{ name: 'Object Explorer', contribution: PositronObjectExplorerContribution, scheme: Schemas.positronObjectExplorer, editorId: PositronObjectExplorerEditorInput.EditorID },
		{ name: 'Plots editor', contribution: PositronPlotsEditorContribution, scheme: Schemas.positronPlotsEditor, editorId: PositronPlotsEditorInput.EditorID },
		{ name: 'Plots gallery editor', contribution: PositronPlotsGalleryEditorContribution, scheme: Schemas.positronPlotsGallery, editorId: PositronPlotsGalleryEditorInput.EditorID },
		{ name: 'Preview editor', contribution: PositronPreviewEditorContribution, scheme: Schemas.positronPreviewEditor, editorId: PositronPreviewEditorInput.EditorID },
	])('$name opens its scheme when a user association matches every file', async ({ contribution, scheme, editorId }) => {
		const editorResolverService = await createResolver(contribution, { '*': DEFAULT_EDITOR_ASSOCIATION.id });

		const resource = URI.from({ scheme, path: `${scheme}-1` });
		expect(editorResolverService.getEditorMatches(resource).defaultRule.editor.id).toBe(editorId);
	});

	it('lets a user association override the Data Explorer for data files', async () => {
		const editorResolverService = await createResolver(PositronDataExplorerContribution, { '*.csv': DEFAULT_EDITOR_ASSOCIATION.id });

		const resource = URI.file('/workspace/data.csv');
		expect(editorResolverService.getEditorMatches(resource).defaultRule.editor.id).toBe(DEFAULT_EDITOR_ASSOCIATION.id);
	});
});
