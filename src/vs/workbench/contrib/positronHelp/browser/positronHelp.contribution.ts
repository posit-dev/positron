/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { PositronHelpFocused } from '../../../common/contextkeys.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { PositronHelpView } from './positronHelpView.js';
import { IPositronHelpService, POSITRON_HELP_SHOWN, POSITRON_HELP_VIEW_ID } from './positronHelpService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SIMPLIFIED_LAYOUT_ENABLED_KEY } from '../../../services/positronLayout/common/positronSimplifiedLayoutConfiguration.js';
import { POSITRON_HELP_COPY, POSITRON_HELP_FIND } from './positronHelpIdentifiers.js';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CloseHelpPane, ListPackageDocs, LookupHelpTopic, ReadHelpTopic, ReadVignette, ShowHelpAtCursor, ShowHelpPane } from './positronHelpActions.js';

// The Positron help view icon.
const positronHelpViewIcon = registerIcon('positron-help-view-icon', Codicon.positronHelpView, nls.localize('positronHelpViewIcon', 'View icon of the Positron help view.'));

// Register the Positron help container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
	ViewContainerExtensions.ViewContainersRegistry
).registerViewContainer(
	{
		id: POSITRON_HELP_VIEW_ID,
		title: {
			value: nls.localize('positron.help', "Help"),
			original: 'Help'
		},
		icon: positronHelpViewIcon,
		order: 2,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_HELP_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_HELP_VIEW_ID,
		hideIfEmpty: true,
	},
	ViewContainerLocation.AuxiliaryBar,
	{
		// The view registers its own open command below. A second one for the container
		// would show up as a second "View: Toggle Help" in the command palette.
		doNotRegisterOpenCommand: true,
		isDefault: false
	}
);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_HELP_VIEW_ID,
	name: {
		value: nls.localize('positron.help', "Help"),
		original: 'Help'
	},
	containerIcon: positronHelpViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronHelpView),
	// In the simplified layout, the Help pane is hidden until it is shown.
	when: ContextKeyExpr.or(ContextKeyExpr.notEquals(`config.${SIMPLIFIED_LAYOUT_ENABLED_KEY}`, true), POSITRON_HELP_SHOWN),
	positronAlwaysOpenView: true,
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.openHelp',
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
		},
		order: 1,
	},
	focusCommand: {
		id: `${POSITRON_HELP_VIEW_ID}.focus`,
		agentCompatible: true,
		readOnly: true,
	},
}], VIEW_CONTAINER);

// Register keybinding rule for copy.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_HELP_COPY,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronHelpFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_HELP_FIND,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyF,
	when: PositronHelpFocused,
	handler: accessor => {
		accessor.get(IPositronHelpService).find();
	}
} satisfies ICommandAndKeybindingRule);

class PositronHelpContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronHelp';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
		registerAction2(ShowHelpAtCursor);
		registerAction2(LookupHelpTopic);
		registerAction2(ReadHelpTopic);
		registerAction2(ListPackageDocs);
		registerAction2(ReadVignette);
		registerAction2(ShowHelpPane);
		registerAction2(CloseHelpPane);
	}
}

// Really does need to be `WorkbenchPhase.BlockStartup`. Any later and the keybindings registered
// by `ShowHelpAtCursor` are registered "too late", i.e. after the core set of system keybindings
// have been set https://github.com/posit-dev/positron/issues/2523.
registerWorkbenchContribution2(PositronHelpContribution.ID, PositronHelpContribution, WorkbenchPhase.BlockStartup);
