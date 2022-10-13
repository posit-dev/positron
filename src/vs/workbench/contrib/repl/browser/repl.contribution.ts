/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ReplCommandId, REPL_VIEW_ID } from 'vs/workbench/contrib/repl/common/repl';
import { IReplService } from 'vs/workbench/contrib/repl/browser/repl';
import { terminalViewIcon } from 'vs/workbench/contrib/terminal/browser/terminalIcons';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, ViewContainerLocation, IViewsRegistry } from 'vs/workbench/common/views';
import * as nls from 'vs/nls';
import { registerReplActions } from 'vs/workbench/contrib/repl/browser/replActions';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ReplService } from 'vs/workbench/contrib/repl/browser/replService';
import { ReplViewPane } from 'vs/workbench/contrib/repl/browser/replView';

// Register REPL service singleton with platform
registerSingleton(IReplService, ReplService, InstantiationType.Delayed);

// Register the REPL view with the views registry
const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: REPL_VIEW_ID,
	title: nls.localize('repl', "Console"),
	icon: terminalViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [REPL_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: REPL_VIEW_ID,
	hideIfEmpty: true,
	order: 3,
}, ViewContainerLocation.Panel, { doNotRegisterOpenCommand: true, isDefault: true });
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: REPL_VIEW_ID,
	name: nls.localize('repl', "Console"),
	containerIcon: terminalViewIcon,
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
