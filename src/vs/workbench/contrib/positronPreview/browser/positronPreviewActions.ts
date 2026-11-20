/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronPreviewService, POSITRON_PREVIEW_VIEW_ID } from './positronPreviewSevice.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { URI } from '../../../../base/common/uri.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Event } from '../../../../base/common/event.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { FocusedViewContext } from '../../../common/contextkeys.js';
import { POSIT_ASSISTANT_CAN_CHAT } from '../../positronAssistant/browser/positAssistantChat.js';
import { PreviewHtml } from './previewHtml.js';
import { PreviewWebview } from './previewWebview.js';

/** How long to wait for a page to load when asked to. */
const LOAD_TIMEOUT_MS = 30_000;

export const POSITRON_PREVIEW_ACTION_CATEGORY = nls.localize('positronViewerCategory', "Viewer");
const category: ILocalizedString = { value: POSITRON_PREVIEW_ACTION_CATEGORY, original: 'Viewer' };

/** Whether the Viewer is showing anything. */
export const POSITRON_VIEWER_HAS_CONTENT = new RawContextKey<boolean>('positronViewer.hasContent', false);

/** Whether the Viewer is showing content with an address, which can be navigated and opened elsewhere. */
export const POSITRON_VIEWER_HAS_ADDRESS = new RawContextKey<boolean>('positronViewer.hasAddress', false);

/** Whether the Viewer is showing content in the integrated browser. */
export const POSITRON_VIEWER_IS_INTEGRATED_BROWSER = new RawContextKey<boolean>('positronViewer.isIntegratedBrowser', false);

/** Sending the Viewer's content to Posit Assistant needs the integrated browser, AI features, and a chat model. */
export const POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT = ContextKeyExpr.and(POSITRON_VIEWER_IS_INTEGRATED_BROWSER, POSIT_ASSISTANT_CAN_CHAT)!;

/** Whether the Viewer's content can reload when a file it loaded changes on disk. */
export const POSITRON_VIEWER_CAN_AUTO_REFRESH = new RawContextKey<boolean>('positronViewer.canAutoRefresh', false);

/** Whether the Viewer's content reloads when a file it loaded changes on disk. */
export const POSITRON_VIEWER_AUTO_REFRESH = new RawContextKey<boolean>('positronViewer.autoRefresh', false);

/** Turns reloading the Viewer's content when its files change on and off. */
export const POSITRON_VIEWER_TOGGLE_AUTO_REFRESH = 'workbench.action.positronPreview.toggleAutoRefresh';

/** Whether the page in the Viewer's integrated browser can zoom in, or out. */
export const POSITRON_VIEWER_CAN_ZOOM_IN = new RawContextKey<boolean>('positronViewer.canZoomIn', false);
export const POSITRON_VIEWER_CAN_ZOOM_OUT = new RawContextKey<boolean>('positronViewer.canZoomOut', false);

/** Whether the Viewer's integrated browser fits pages to its width. */
export const POSITRON_VIEWER_FIT_TO_WIDTH = new RawContextKey<boolean>('positronViewer.fitToWidth', false);

/** The commands that act on the integrated browser showing in the Viewer, for its toolbar. */
export const VIEWER_BROWSER_COMMANDS = {
	zoomIn: 'workbench.action.positronPreview.zoomIn',
	zoomOut: 'workbench.action.positronPreview.zoomOut',
	resetZoom: 'workbench.action.positronPreview.resetZoom',
	toggleFitToWidth: 'workbench.action.positronPreview.toggleFitToWidth',
	toggleDevTools: 'workbench.action.positronPreview.toggleDevTools',
	addElement: 'workbench.action.positronPreview.addElementToAssistant',
	commentOnElement: 'workbench.action.positronPreview.commentOnElement',
	addScreenshot: 'workbench.action.positronPreview.addScreenshotToAssistant',
	addConsoleLogs: 'workbench.action.positronPreview.addConsoleLogsToAssistant',
} as const;

/**
 * A Viewer action that runs against the active preview.
 */
abstract class ViewerPreviewAction extends Action2 {
	run(accessor: ServicesAccessor): void {
		const preview = accessor.get(IPositronPreviewService).activePreviewWebview;
		if (preview) {
			this.runOnPreview(accessor, preview);
		}
	}

	protected abstract runOnPreview(accessor: ServicesAccessor, preview: PreviewWebview): void;
}

export class PositronViewerGoBackAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.positronPreview.goBack',
			title: nls.localize2('positronViewerGoBack', "Go Back"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_HAS_CONTENT,
			metadata: {
				description: nls.localize('positronViewerGoBack.description', "Go back to the previous page in the Viewer."),
				agentCompatible: true,
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IPositronPreviewService).goBack();
	}
}

export class PositronViewerGoForwardAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.positronPreview.goForward',
			title: nls.localize2('positronViewerGoForward', "Go Forward"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_HAS_CONTENT,
			metadata: {
				description: nls.localize('positronViewerGoForward.description', "Go forward to the next page in the Viewer."),
				agentCompatible: true,
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IPositronPreviewService).goForward();
	}
}

export class PositronViewerReloadAction extends ViewerPreviewAction {
	constructor() {
		super({
			id: 'workbench.action.positronPreview.reload',
			title: nls.localize2('positronViewerReload', "Reload"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_HAS_ADDRESS,
			metadata: {
				description: nls.localize('positronViewerReload.description', "Reload the page in the Viewer."),
				agentCompatible: true,
			}
		});
	}

	protected runOnPreview(_accessor: ServicesAccessor, preview: PreviewWebview): void {
		preview.surface.reload();
	}
}

export class PositronViewerClearAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.positronPreview.clear',
			title: nls.localize2('positronViewerClear', "Clear"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_HAS_CONTENT,
			metadata: {
				description: nls.localize('positronViewerClear.description', "Clear the content of the Viewer."),
				agentCompatible: true,
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IPositronPreviewService).clearAllPreviews();
	}
}

export class PositronViewerFindAction extends ViewerPreviewAction {
	constructor() {
		super({
			id: 'workbench.action.positronPreview.find',
			title: nls.localize2('positronViewerFind', "Find"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_HAS_CONTENT,
			keybinding: {
				when: ContextKeyExpr.and(POSITRON_VIEWER_HAS_CONTENT, FocusedViewContext.isEqualTo(POSITRON_PREVIEW_VIEW_ID)),
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyF,
			},
		});
	}

	protected runOnPreview(_accessor: ServicesAccessor, preview: PreviewWebview): void {
		preview.surface.find();
	}
}

export class PositronViewerOpenInBrowserAction extends ViewerPreviewAction {
	constructor() {
		super({
			id: 'workbench.action.positronPreview.openInBrowser',
			title: nls.localize2('positronViewerOpenInBrowser', "Open in Browser"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_HAS_ADDRESS,
		});
	}

	protected runOnPreview(accessor: ServicesAccessor, preview: PreviewWebview): void {
		if (preview.address) {
			accessor.get(IOpenerService).open(preview.address, { openExternal: true, fromUserGesture: true });
		}
	}
}

export class PositronViewerOpenInEditorAction extends ViewerPreviewAction {
	constructor() {
		super({
			id: 'workbench.action.positronPreview.openInEditor',
			title: nls.localize2('positronViewerOpenInEditor', "Open in Editor Tab"),
			f1: true,
			category,
			precondition: POSITRON_VIEWER_HAS_ADDRESS,
		});
	}

	protected runOnPreview(accessor: ServicesAccessor, preview: PreviewWebview): void {
		if (preview.address) {
			const title = preview.surface.title || (preview instanceof PreviewHtml ? preview.html?.title : undefined);
			accessor.get(IPositronPreviewService).openEditor(preview.address, title);
		}
	}
}

export class PositronOpenUrlInViewerAction extends Action2 {

	static ID = 'workbench.action.positronPreview.openUrl';

	private static _previewCounter = 0;

	constructor() {
		super({
			id: PositronOpenUrlInViewerAction.ID,
			title: nls.localize2('positronOpenUrlInViewer', "Open URL in Viewer"),
			f1: true,
			category,
			metadata: {
				description: nls.localize('positronOpenUrlInViewer.description', "Open an http or https URL in the Viewer pane."),
				agentCompatible: true,
				args: [{
					name: 'url',
					isOptional: true,
					description: 'The http or https URL to open. Omit to prompt the user for a URL.',
					schema: { type: 'string' }
				}, {
					name: 'waitForLoad',
					isOptional: true,
					description: `Whether to wait until the page has loaded in the Viewer before returning. Fails if it hasn't loaded within ${LOAD_TIMEOUT_MS / 1000} seconds.`,
					schema: { type: 'boolean' }
				}]
			}
		});
	}

	/**
	 * Runs the action.
	 *
	 * @param accessor The service accessor.
	 * @param url The URL to open; the user is prompted for one if omitted.
	 * @param waitForLoad Whether to wait until the page has loaded.
	 */
	async run(accessor: ServicesAccessor, url?: string, waitForLoad?: boolean) {
		// Load services from accessor
		const previewService = accessor.get(IPositronPreviewService);
		const quickInputService = accessor.get(IQuickInputService);
		const openerService = accessor.get(IOpenerService);

		// Ask the user to input a URL if none was given; don't do anything if
		// the user cancels
		if (!url) {
			url = await quickInputService.input(
				{ prompt: nls.localize('positronOpenUrlInViewer.prompt', "Enter the URL to open in the viewer") });
			if (!url) {
				return;
			}
		}

		// If there's no ://, assume http://
		if (!url.includes('://')) {
			url = `http://${url}`;
		}

		// Parse the URL and make sure it's an http or https URL; we can't load
		// other types
		let uri = URI.parse(url);
		if (uri.scheme !== 'http' && uri.scheme !== 'https') {
			throw new Error(nls.localize('positronOpenUrlInViewer.invalidScheme', "The URL '{0}' has an invalid scheme; only 'http' and 'https' are supported.", url));
		}

		// Resolve the URI so that localhost URLs work when Positron is running
		// remotely
		try {
			uri = (await openerService.resolveExternalUri(uri)).resolved;
		} catch {
			// Noop; use the original URI
		}

		const previewId = `userRequestedPreview-${PositronOpenUrlInViewerAction._previewCounter++}`;
		const preview = previewService.openUri(previewId, undefined, uri);

		if (waitForLoad) {
			const loaded = Event.toPromise(preview.surface.onDidLoad);
			if (await raceTimeout(loaded.then(() => true), LOAD_TIMEOUT_MS, () => loaded.cancel()) !== true) {
				throw new Error(nls.localize('positronOpenUrlInViewer.loadTimeout', "The URL '{0}' was opened in the Viewer, but the page didn't finish loading within {1} seconds.", url, LOAD_TIMEOUT_MS / 1000));
			}
		}
	}
}
