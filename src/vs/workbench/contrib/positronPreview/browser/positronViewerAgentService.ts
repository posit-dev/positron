/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout, timeout } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { PreviewSourceType } from '../../../services/languageRuntime/common/positronUiComm.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { IPositronViewerAgentService, IViewerInfo, IViewerScreenshot, IViewerSnapshot, IViewerSnapshotOptions, ViewerContentKind } from '../common/positronViewerAgent.js';
import { IPositronPreviewService, POSITRON_PREVIEW_HTML_VIEW_TYPE, POSITRON_PREVIEW_VIEW_ID } from './positronPreviewSevice.js';
import { PreviewHtml } from './previewHtml.js';
import { PreviewUrl, QUERY_NONCE_PARAMETER } from './previewUrl.js';
import { PreviewWebview } from './previewWebview.js';

/**
 * The longest a call into the app's page may take. The bridge's own waits
 * time out well before this; it's for pages that stop responding, for
 * example because they navigated away mid-call.
 */
const BRIDGE_CALL_TIMEOUT_MS = 20_000;

/**
 * How long to wait for the app to take its full size after the Viewer is
 * revealed. A hidden Viewer's frame shrinks, and the app lays itself out
 * again when it grows back.
 */
const LAYOUT_TIMEOUT_MS = 3_000;

/**
 * Removes the cache-busting parameter that the Viewer adds to URLs, which
 * would only confuse an agent.
 */
function cleanUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.searchParams.delete(QUERY_NONCE_PARAMETER);
		return parsed.toString();
	} catch {
		return url;
	}
}

function uriToString(uri: URI): string {
	return cleanUrl(uri.toString(true));
}

/**
 * Rejects if a call into the app's page doesn't finish in time.
 */
async function withBridgeTimeout<T>(promise: Promise<T>): Promise<T> {
	let timedOut = false;
	const result = await raceTimeout(promise, BRIDGE_CALL_TIMEOUT_MS, () => timedOut = true);
	if (timedOut) {
		throw new Error('The page in the Viewer stopped responding.');
	}
	return result as T;
}

/**
 * Says what kind of content a preview shows.
 */
function contentKindOf(preview: PreviewWebview | undefined): ViewerContentKind {
	if (!preview) {
		return 'none';
	}
	if (preview instanceof PreviewUrl) {
		return 'url';
	}
	// HTML files (PreviewHtml) and HTML strings shown with openHtmlString.
	if (preview.viewType === POSITRON_PREVIEW_HTML_VIEW_TYPE) {
		return 'html';
	}
	return 'other';
}

/**
 * Gives AI agents read access to the content of the Viewer pane. Agents get
 * it through the `positron.ai` extension API; the checks live here so every
 * caller gets them.
 */
export class PositronViewerAgentService implements IPositronViewerAgentService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IPositronPreviewService private readonly _previewService: IPositronPreviewService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) { }

	getViewerInfo(): IViewerInfo {
		this.checkEnabled();
		const visible = this._viewsService.isViewVisible(POSITRON_PREVIEW_VIEW_ID);
		const preview = this._previewService.activePreviewWebview;
		const kind = contentKindOf(preview);
		if (!preview) {
			return { kind, visible };
		}
		const title = preview.webview.title;
		if (preview instanceof PreviewUrl) {
			const source = preview.source;
			return {
				kind,
				title,
				url: uriToString(preview.currentUri),
				sourceSessionId: source?.type === PreviewSourceType.Runtime ? source.id : undefined,
				visible,
			};
		}
		if (preview instanceof PreviewHtml) {
			return {
				kind,
				title: title || preview.html?.title || undefined,
				url: uriToString(preview.uri),
				sourceSessionId: preview.sessionId || undefined,
				visible,
			};
		}
		return { kind, title: title || preview.name, visible };
	}

	async getViewerSnapshot(options?: IViewerSnapshotOptions): Promise<IViewerSnapshot> {
		this.checkEnabled();
		const preview = this.readablePreview();
		// Snapshot once the app has settled: a snapshot taken while Streamlit is
		// still rendering comes back empty.
		await withBridgeTimeout(preview.webview.runBridge('waitForIdle'));
		const snapshot = await withBridgeTimeout(preview.webview.runBridge('snapshot', options));
		return { ...snapshot, url: cleanUrl(snapshot.url) };
	}

	async getViewerScreenshot(): Promise<IViewerScreenshot> {
		this.checkEnabled();
		const preview = this.readablePreview();

		// Make sure the page can be reached before changing the user's layout,
		// so a call that would fail anyway doesn't reveal the Viewer for nothing.
		await withBridgeTimeout(preview.webview.runBridge('viewport'));

		// The Viewer has to be showing: Desktop captures the screen, and in web
		// builds a hidden Viewer's frame shrinks to 300x150, so the app lays
		// itself out at that size.
		const revealed = !this._viewsService.isViewVisible(POSITRON_PREVIEW_VIEW_ID);
		if (revealed) {
			await this._viewsService.openView(POSITRON_PREVIEW_VIEW_ID, false);
		}
		await this.waitForLayout(preview);
		await withBridgeTimeout(preview.webview.runBridge('waitForIdle'));

		const capture = await preview.webview.captureScreenshot();
		return { mimeType: 'image/png', ...capture, revealed };
	}

	/**
	 * Throws unless AI features are turned on. Read on every call, since the
	 * setting can change without a reload.
	 */
	private checkEnabled(): void {
		if (this._configurationService.getValue<boolean>(AI_ENABLED_KEY) !== true) {
			throw new Error(`Agent access to the Viewer is off, because AI features are turned off (the ${AI_ENABLED_KEY} setting).`);
		}
	}

	/**
	 * Gets the active preview, if it's one agents can read.
	 */
	private readablePreview(): PreviewWebview {
		const preview = this._previewService.activePreviewWebview;
		if (!preview) {
			throw new Error('Nothing is showing in the Viewer.');
		}
		if (contentKindOf(preview) === 'other') {
			throw new Error('Agents can\'t read this kind of Viewer content yet.');
		}
		return preview;
	}

	/**
	 * Waits until the app's viewport matches the Viewer's size on screen.
	 * Throws if it hasn't after LAYOUT_TIMEOUT_MS, rather than capturing the
	 * app at the wrong size.
	 */
	private async waitForLayout(preview: PreviewWebview): Promise<void> {
		const deadline = Date.now() + LAYOUT_TIMEOUT_MS;
		for (; ;) {
			const rect = preview.webview.webview.container.getBoundingClientRect();
			const viewport = await withBridgeTimeout(preview.webview.runBridge('viewport'));
			const laidOut = rect.width > 0 && rect.height > 0 &&
				Math.abs(viewport.width - rect.width) <= 2 && Math.abs(viewport.height - rect.height) <= 2;
			if (laidOut) {
				return;
			}
			if (Date.now() >= deadline) {
				if (rect.width === 0 || rect.height === 0) {
					throw new Error('The Viewer has no room on screen to show its content.');
				}
				throw new Error(`The page in the Viewer is laid out at ${viewport.width}x${viewport.height}, ` +
					`not the Viewer's ${Math.round(rect.width)}x${Math.round(rect.height)}, so a screenshot would be wrong. Try again in a moment.`);
			}
			await timeout(100);
		}
	}
}
