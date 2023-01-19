/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ReplCommandId, REPL_VIEW_ID } from 'vs/workbench/contrib/repl/common/replCommands';
import { IReplService } from 'vs/workbench/contrib/repl/common/repl';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, ViewContainerLocation, IViewsRegistry } from 'vs/workbench/common/views';
import * as nls from 'vs/nls';
import { registerReplActions } from 'vs/workbench/contrib/repl/browser/replActions';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ReplService } from 'vs/workbench/contrib/repl/common/replService';
import { ReplViewPane } from 'vs/workbench/contrib/repl/browser/replView';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { Codicon } from 'vs/base/common/codicons';

// Register REPL service singleton with platform
registerSingleton(IReplService, ReplService, InstantiationType.Delayed);

// The Positron console view icon.
const positronConsoleViewIcon = registerIcon('positron-console-view-icon', Codicon.positronConsoleView, nls.localize('positronConsoleViewIcon', 'View icon of the Positron console view.'));

// Register the REPL view with the views registry
const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: REPL_VIEW_ID,
	title: nls.localize('repl', "Console"),
	icon: positronConsoleViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [REPL_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: REPL_VIEW_ID,
	hideIfEmpty: true,
	order: 3,
}, ViewContainerLocation.Panel, { doNotRegisterOpenCommand: true, isDefault: true });
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: REPL_VIEW_ID,
	name: nls.localize('repl', "Console"),
	containerIcon: positronConsoleViewIcon,
	canToggleVisibility: false,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(ReplViewPane),
	openCommandActionDescriptor: {
		id: ReplCommandId.Open,
		mnemonicTitle: nls.localize({ key: 'miOpenRepl', comment: ['&& denotes a mnemonic'] }, "&&Console"),
		// TODO: Need a default keybinding for opening the REPL
		keybindings: {},
		order: 3
	}
}], VIEW_CONTAINER);

// Register all the REPL commands
registerReplActions();
