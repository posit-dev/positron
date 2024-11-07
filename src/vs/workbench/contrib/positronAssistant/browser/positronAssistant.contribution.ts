/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from 'vs/workbench/common/views';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { PositronAssistantView } from 'vs/workbench/contrib/positronAssistant/browser/positronAssistantView';

const POSITRON_ASSISTANT_VIEW_ID = 'workbench.panel.positronAssistant';
const positronAssistantViewIcon = registerIcon(
	'positron-connections-view-icon',
	Codicon.commentDiscussion,
	nls.localize('positronAsssistantViewIcon', 'View icon of the Positron Assistant view.')
);

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer(
	{
		id: POSITRON_ASSISTANT_VIEW_ID,
		title: {
			value: nls.localize('positron.connections', "Assistant"),
			original: 'Assistant'
		},
		icon: positronAssistantViewIcon,
		order: 2,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_ASSISTANT_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_ASSISTANT_VIEW_ID,
		hideIfEmpty: true,
	},
	ViewContainerLocation.Sidebar,
	{
		doNotRegisterOpenCommand: false,
		isDefault: false
	}
);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([{
	id: POSITRON_ASSISTANT_VIEW_ID,
	name: {
		value: nls.localize('positron.assistant.core', "Assistant"),
		original: 'Assistant'
	},
	containerIcon: positronAssistantViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronAssistantView),
	positronAlwaysOpenView: true,
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.openAssistant',
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
		},
		order: 1,
	}
}], VIEW_CONTAINER);
