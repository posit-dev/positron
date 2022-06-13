/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ReplCommandId, REPL_VIEW_ID } from 'vs/workbench/contrib/repl/common/repl';
import { terminalViewIcon } from 'vs/workbench/contrib/terminal/browser/terminalIcons';
import { TerminalViewPane } from 'vs/workbench/contrib/terminal/browser/terminalView';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, ViewContainerLocation, IViewsRegistry } from 'vs/workbench/common/views';
import * as nls from 'vs/nls';

// Register the REPL view with the views registry
const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: REPL_VIEW_ID,
	title: nls.localize('repl', "Console"),
	icon: terminalViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [REPL_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: REPL_VIEW_ID,
	hideIfEmpty: true,
	order: 3,
}, ViewContainerLocation.Panel, { donotRegisterOpenCommand: true, isDefault: true });
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: REPL_VIEW_ID,
	name: nls.localize('repl', "Console"),
	containerIcon: terminalViewIcon,
	canToggleVisibility: false,
	canMoveView: true,
	// TODO: Should be the ReplViewPane when it's created
	ctorDescriptor: new SyncDescriptor(TerminalViewPane),
	openCommandActionDescriptor: {
		id: ReplCommandId.New,
		mnemonicTitle: nls.localize({ key: 'miNewRepl', comment: ['&& denotes a mnemonic'] }, "&&Console"),
		// TODO: Need a default keybinding for opening the REPL
		keybindings: {},
		order: 3
	}
}], VIEW_CONTAINER);
