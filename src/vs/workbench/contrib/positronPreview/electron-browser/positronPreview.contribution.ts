/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronPreviewService, POSITRON_PREVIEW_VIEW_ID, POSITRON_VIEWER_USE_INTEGRATED_BROWSER } from '../browser/positronPreviewSevice.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ElectronPositronPreviewService } from './positronPreviewServiceImpl.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { FocusedViewContext } from '../../../common/contextkeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindings, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { localize, localize2 } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { PreviewBrowserView } from './previewBrowserView.js';
import { POSITRON_VIEWER_FIND_FOCUSED, POSITRON_VIEWER_FIND_VISIBLE, VIEWER_FIND_NEXT_ID, VIEWER_FIND_PREVIOUS_ID, VIEWER_HIDE_FIND_ID } from './viewerFindWidget.js';
import { ToggleViewerFitToWidthAction, ViewerResetZoomAction, ViewerZoomContribution, ViewerZoomInAction, ViewerZoomOutAction } from './viewerZoom.js';
import { AddViewerConsoleLogsAction, AddViewerElementAction, AddViewerScreenshotAction, CommentOnViewerElementAction, ToggleViewerDevToolsAction, ViewerAssistantContribution } from './viewerAssistant.js';

// Register the Electron variant of the Positron preview service.
registerSingleton(IPositronPreviewService, ElectronPositronPreviewService, InstantiationType.Delayed);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'positron',
	properties: {
		[POSITRON_VIEWER_USE_INTEGRATED_BROWSER]: {
			scope: ConfigurationScope.APPLICATION,
			type: 'boolean',
			default: true,
			description: localize('positron.viewer.useIntegratedBrowser', "Show web pages and HTML in the Viewer using the integrated browser. When off, the Viewer uses a webview.")
		},
	}
});

/** Runs a find command against the integrated browser showing in the Viewer. */
function registerFindCommand(id: string, title: ILocalizedString, keybindings: (IKeybindings & { when: ContextKeyExpression | undefined })[], run: (surface: PreviewBrowserView) => void): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id, title, precondition: POSITRON_VIEWER_FIND_VISIBLE, keybinding: keybindings.map(keybinding => ({ ...keybinding, weight: KeybindingWeight.WorkbenchContrib + 5 })) });
		}

		run(accessor: ServicesAccessor): void {
			const surface = accessor.get(IPositronPreviewService).activePreviewWebview?.surface;
			if (surface instanceof PreviewBrowserView) {
				run(surface);
			}
		}
	});
}

// Escape, F3 and Cmd+G work while the find widget shows, even with focus in the page.
const findShowing = ContextKeyExpr.and(POSITRON_VIEWER_FIND_VISIBLE, FocusedViewContext.isEqualTo(POSITRON_PREVIEW_VIEW_ID));
registerFindCommand(VIEWER_FIND_NEXT_ID, localize2('positronViewerFindNext', "Find Next"), [
	{ primary: KeyCode.Enter, when: POSITRON_VIEWER_FIND_FOCUSED },
	{ primary: KeyCode.F3, mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyG }, when: findShowing },
], surface => surface.findNext(false));
registerFindCommand(VIEWER_FIND_PREVIOUS_ID, localize2('positronViewerFindPrevious', "Find Previous"), [
	{ primary: KeyMod.Shift | KeyCode.Enter, when: POSITRON_VIEWER_FIND_FOCUSED },
	{ primary: KeyMod.Shift | KeyCode.F3, mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG }, when: findShowing },
], surface => surface.findNext(true));
registerFindCommand(VIEWER_HIDE_FIND_ID, localize2('positronViewerHideFind', "Close Find"), [
	{ primary: KeyCode.Escape, when: findShowing },
], surface => surface.hideFind());

registerAction2(ViewerZoomInAction);
registerAction2(ViewerZoomOutAction);
registerAction2(ViewerResetZoomAction);
registerAction2(ToggleViewerFitToWidthAction);
registerWorkbenchContribution2(ViewerZoomContribution.ID, ViewerZoomContribution, WorkbenchPhase.AfterRestored);
registerAction2(ToggleViewerDevToolsAction);
registerAction2(AddViewerElementAction);
registerAction2(CommentOnViewerElementAction);
registerAction2(AddViewerScreenshotAction);
registerAction2(AddViewerConsoleLogsAction);
registerWorkbenchContribution2(ViewerAssistantContribution.ID, ViewerAssistantContribution, WorkbenchPhase.AfterRestored);
