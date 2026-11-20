/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { localize2 } from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { browserZoomAccessibilityLabel } from '../../../../platform/browserView/common/browserView.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindings, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { FocusedViewContext } from '../../../common/contextkeys.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IPositronPreviewService, POSITRON_PREVIEW_VIEW_ID } from '../browser/positronPreviewSevice.js';
import { POSITRON_PREVIEW_ACTION_CATEGORY, POSITRON_VIEWER_CAN_ZOOM_IN, POSITRON_VIEWER_CAN_ZOOM_OUT, POSITRON_VIEWER_FIT_TO_WIDTH, POSITRON_VIEWER_IS_INTEGRATED_BROWSER, VIEWER_BROWSER_COMMANDS } from '../browser/positronPreviewActions.js';
import { PreviewBrowserView } from './previewBrowserView.js';

const category = { value: POSITRON_PREVIEW_ACTION_CATEGORY, original: 'Viewer' };

/** The integrated browser showing in the Viewer, if any. */
function activeBrowser(previewService: IPositronPreviewService): PreviewBrowserView | undefined {
	const surface = previewService.activePreviewWebview?.surface;
	return surface instanceof PreviewBrowserView ? surface : undefined;
}

/**
 * Keeps the zoom context keys in step with the page in the Viewer's
 * integrated browser, and announces the zoom when the user changes it.
 */
export class ViewerZoomContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronViewerZoom';

	private readonly _listener = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IPositronPreviewService previewService: IPositronPreviewService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super();
		const canZoomIn = POSITRON_VIEWER_CAN_ZOOM_IN.bindTo(contextKeyService);
		const canZoomOut = POSITRON_VIEWER_CAN_ZOOM_OUT.bindTo(contextKeyService);
		const fitToWidth = POSITRON_VIEWER_FIT_TO_WIDTH.bindTo(contextKeyService);
		const listen = () => {
			const browser = activeBrowser(previewService);
			const update = () => {
				canZoomIn.set(browser?.canZoomIn ?? false);
				canZoomOut.set(browser?.canZoomOut ?? false);
				fitToWidth.set(browser?.fitToWidth ?? false);
			};
			const store = this._listener.value = new DisposableStore();
			if (browser) {
				store.add(browser.onDidChangeZoom(update));
				store.add(browser.onDidZoom(factor => accessibilityService.status(browserZoomAccessibilityLabel(factor))));
			}
			update();
		};
		listen();
		this._register(previewService.onDidChangeActivePreviewWebview(listen));
	}
}

/** The same keys as the workbench's zoom, while the Viewer's integrated browser has focus. */
const whenFocused = ContextKeyExpr.and(FocusedViewContext.isEqualTo(POSITRON_PREVIEW_VIEW_ID), POSITRON_VIEWER_IS_INTEGRATED_BROWSER);

abstract class ViewerZoomAction extends Action2 {
	constructor(id: string, title: ILocalizedString, keybinding: IKeybindings, precondition: ContextKeyExpression | undefined = POSITRON_VIEWER_IS_INTEGRATED_BROWSER) {
		super({
			id,
			title,
			f1: true,
			category,
			precondition,
			keybinding: { ...keybinding, when: whenFocused, weight: KeybindingWeight.WorkbenchContrib + 75 },
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const browser = activeBrowser(accessor.get(IPositronPreviewService));
		if (browser) {
			await this.runOnBrowser(browser);
		}
	}

	protected abstract runOnBrowser(browser: PreviewBrowserView): Promise<void> | void;
}

export class ViewerZoomInAction extends ViewerZoomAction {
	constructor() {
		super(VIEWER_BROWSER_COMMANDS.zoomIn, localize2('positronViewerZoomIn', "Zoom In"), {
			primary: KeyMod.CtrlCmd | KeyCode.Equal,
			secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Equal, KeyMod.CtrlCmd | KeyCode.NumpadAdd],
		}, ContextKeyExpr.and(POSITRON_VIEWER_IS_INTEGRATED_BROWSER, POSITRON_VIEWER_CAN_ZOOM_IN));
	}

	protected runOnBrowser(browser: PreviewBrowserView): Promise<void> {
		return browser.zoomIn();
	}
}

export class ViewerZoomOutAction extends ViewerZoomAction {
	constructor() {
		super(VIEWER_BROWSER_COMMANDS.zoomOut, localize2('positronViewerZoomOut', "Zoom Out"), {
			primary: KeyMod.CtrlCmd | KeyCode.Minus,
			secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Minus, KeyMod.CtrlCmd | KeyCode.NumpadSubtract],
			linux: { primary: KeyMod.CtrlCmd | KeyCode.Minus, secondary: [KeyMod.CtrlCmd | KeyCode.NumpadSubtract] },
		}, ContextKeyExpr.and(POSITRON_VIEWER_IS_INTEGRATED_BROWSER, POSITRON_VIEWER_CAN_ZOOM_OUT));
	}

	protected runOnBrowser(browser: PreviewBrowserView): Promise<void> {
		return browser.zoomOut();
	}
}

export class ViewerResetZoomAction extends ViewerZoomAction {
	constructor() {
		// Numpad0 rather than Digit0, as the workbench does, which keeps Cmd+0 for focusing the sidebar.
		super(VIEWER_BROWSER_COMMANDS.resetZoom, localize2('positronViewerResetZoom', "Reset Zoom"), { primary: KeyMod.CtrlCmd | KeyCode.Numpad0 });
	}

	protected runOnBrowser(browser: PreviewBrowserView): Promise<void> {
		return browser.resetZoom();
	}
}

export class ToggleViewerFitToWidthAction extends Action2 {
	constructor() {
		super({
			id: VIEWER_BROWSER_COMMANDS.toggleFitToWidth,
			title: localize2('positronViewerToggleFitToWidth', "Toggle Fit to Width"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_IS_INTEGRATED_BROWSER,
			toggled: POSITRON_VIEWER_FIT_TO_WIDTH,
		});
	}

	run(accessor: ServicesAccessor): void {
		const browser = activeBrowser(accessor.get(IPositronPreviewService));
		browser?.setFitToWidth(!browser.fitToWidth);
	}
}
