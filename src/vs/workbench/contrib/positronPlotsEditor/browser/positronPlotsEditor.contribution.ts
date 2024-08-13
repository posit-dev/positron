/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorPaneDescriptor, IEditorPaneRegistry } from 'vs/workbench/browser/editor';
import { applicationConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { registerWorkbenchContribution2, WorkbenchPhase } from 'vs/workbench/common/contributions';
import { EditorExtensions } from 'vs/workbench/common/editor';
import { PositronPlotsEditor } from 'vs/workbench/contrib/positronPlotsEditor/browser/positronPlotsEditor';
import { PositronPlotsEditorInput } from 'vs/workbench/contrib/positronPlotsEditor/browser/positronPlotsEditorInput';
import { IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';

export const POSITRON_EDITOR_PLOTS = 'workbench.experimental.positronPlotsEditor';

class PositronPlotsEditorContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronPlotsEditor';

	constructor(
		@IEditorResolverService _editorResolverService: IEditorResolverService,
		@IInstantiationService _instantiationService: IInstantiationService
	) {
		super();

		// Register the editor
		this._register(_editorResolverService.registerEditor(
			`${Schemas.positronPlotsEditor}:**/**`,
			{
				id: PositronPlotsEditorInput.EditorID,
				label: localize('positronPlotsEditor', 'Plots Editor'),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronPlotsEditor
			},
			{
				createEditorInput: ({ resource, options }) => {
					return {
						editor: _instantiationService.createInstance(
							PositronPlotsEditorInput,
							resource
						),
						options: {
							...options,
							// open as a regular editor instead of a preview
							pinned: true
						}
					};
				}
			}
		));
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronPlotsEditor,
		PositronPlotsEditorInput.EditorID,
		'Plots Editor',
	),
	[
		new SyncDescriptor(PositronPlotsEditorInput)
	]
);

registerWorkbenchContribution2(
	PositronPlotsEditorContribution.ID,
	PositronPlotsEditorContribution,
	WorkbenchPhase.AfterRestored
);

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	...applicationConfigurationNodeBase,
	properties: {
		[POSITRON_EDITOR_PLOTS]: {
			scope: ConfigurationScope.APPLICATION,
			type: 'boolean',
			default: true,
			tags: ['experimental'],
			description: localize('workbench.positronPlotsEditor.description', 'When enabled, plots can be opened in an editor.')
		}
	}
});

export function positronPlotsEditorEnabled(configurationService: IConfigurationService) {
	return Boolean(configurationService.getValue(POSITRON_EDITOR_PLOTS));
}
