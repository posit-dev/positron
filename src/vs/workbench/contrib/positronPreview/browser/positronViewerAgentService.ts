/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveElement, isHTMLElement } from '../../../../base/browser/dom.js';
import { raceTimeout, timeout } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { PreviewSourceType } from '../../../services/languageRuntime/common/positronUiComm.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { IPositronViewerAgentService, IViewerActOutcome, IViewerActResult, IViewerInfo, IViewerScreenshot, IViewerSnapshot, IViewerSnapshotOptions, IViewerViewport, ViewerAction, ViewerContentKind } from '../common/positronViewerAgent.js';
import { IPositronPreviewService, POSITRON_PREVIEW_HTML_VIEW_TYPE, POSITRON_PREVIEW_VIEW_ID } from './positronPreviewSevice.js';
import { PreviewHtml } from './previewHtml.js';
import { VIEWER_CONTENT_CHANGED_MESSAGE } from './previewOverlayWebview.js';
import { PreviewUrl, QUERY_NONCE_PARAMETER } from './previewUrl.js';
import { PreviewWebview } from './previewWebview.js';

/**
 * The longest a call into the app's page may take, for pages that stop
 * responding. The bridge's own waits end well before this.
 */
const BRIDGE_CALL_TIMEOUT_MS = 20_000;

/**
 * The longest a screenshot may take. In web builds it's rebuilt from the page,
 * which means fetching the page's images and fonts, each with its own 10
 * second timeout.
 */
const CAPTURE_TIMEOUT_MS = 30_000;

/**
 * The longest an action may take. The bridge gives up on its own waits (for a
 * slider to move, for text to show up) well before this.
 */
const ACT_TIMEOUT_MS = 30_000;

/**
 * How long to wait for the new page after an action takes the Viewer to
 * another address.
 */
const PAGE_LOAD_TIMEOUT_MS = 10_000;

/**
 * How long one try at reaching the new page may take.
 */
const PAGE_PING_TIMEOUT_MS = 2_000;

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timedOut = false;
	const result = await raceTimeout(promise, timeoutMs, () => timedOut = true);
	if (timedOut) {
		throw new Error(message);
	}
	return result as T;
}

function withBridgeTimeout<T>(promise: Promise<T>): Promise<T> {
	return withTimeout(promise, BRIDGE_CALL_TIMEOUT_MS, 'The page in the Viewer stopped responding.');
}

/**
 * Notes where keyboard focus is, and returns a function that takes it back out
 * of `container` if it has moved in since. Acting on a control in the app's
 * page focuses the Viewer, which would send what the user types to the app.
 */
function keepFocusOutOf(container: HTMLElement): () => void {
	const focused = getActiveElement();
	return () => {
		const active = container.ownerDocument.activeElement;
		if (!active || !container.contains(active) || (focused && container.contains(focused))) {
			return;
		}
		if (isHTMLElement(focused) && focused.isConnected && focused !== focused.ownerDocument.body) {
			focused.focus();
		} else if (isHTMLElement(active)) {
			active.blur();
		}
	};
}

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
 * Lets AI agents read and act on the content of the Viewer pane. Agents get
 * it through the positronViewer.* commands; the checks live here so every
 * caller gets them.
 */
export class PositronViewerAgentService implements IPositronViewerAgentService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IPositronPreviewService private readonly _previewService: IPositronPreviewService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) { }

	async getViewerInfo(): Promise<IViewerInfo> {
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
				url: await this.currentUrl(preview),
				sourceSessionId: source?.type === PreviewSourceType.Runtime ? source.id : undefined,
				visible,
			};
		}
		if (preview instanceof PreviewHtml) {
			return {
				kind,
				title: title || preview.html?.title || undefined,
				url: await this.currentUrl(preview),
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
		const snapshot = await this.snapshotOf(preview, options);
		this.checkStillShowing(preview);
		return snapshot;
	}

	async getViewerScreenshot(): Promise<IViewerScreenshot> {
		this.checkEnabled();
		const preview = this.readablePreview();

		// The Viewer has to be showing: Desktop captures the screen.
		const revealed = await this.showViewer(preview);
		await withBridgeTimeout(preview.webview.runBridge('waitForIdle'));

		const capture = await withTimeout(preview.webview.captureScreenshot(), CAPTURE_TIMEOUT_MS,
			'Taking the screenshot of the Viewer took too long.');
		this.checkStillShowing(preview);
		return { mimeType: 'image/png', ...capture, revealed };
	}

	async viewerAct(action: ViewerAction, snapshotOptions?: IViewerSnapshotOptions): Promise<IViewerActResult> {
		this.checkEnabled();
		const preview = this.readablePreview();
		const restoreFocus = keepFocusOutOf(preview.webview.webview.container);
		try {
			// Act on the app at the size the user sees it. A responsive app can
			// hide or move its controls at a hidden web Viewer's 300x150.
			const revealed = await this.showViewer(preview);
			let outcome: IViewerActOutcome;
			let movedOn = false;
			try {
				outcome = await withTimeout(preview.webview.runBridge('act', action), ACT_TIMEOUT_MS,
					'The page in the Viewer stopped responding during the action, which may have been taken. Read the page before trying it again.');
			} catch (error) {
				if (this._previewService.activePreviewWebview === preview) {
					throw error;
				}
				// Other content replaced the page, perhaps because of the action.
				movedOn = true;
				outcome = { message: 'The Viewer moved on to other content before the action finished, so it may have been taken.', navigated: false, timedOut: false };
			}
			// Before the snapshot, so it shows the page after the control loses focus.
			restoreFocus();
			// The action has been taken. From here on, report a problem in the
			// result rather than reject, which would read as the action failing
			// and could lead an agent to take it again.
			try {
				if (outcome.navigated) {
					await this.waitForNewPage(preview);
				}
				// The action may have led the app to open something else in the Viewer.
				const current = this.readablePreview();
				if (current !== preview) {
					await this.waitForNewPage(current);
				}
				const snapshot = await this.snapshotOf(current, snapshotOptions);
				const message = current === preview || movedOn ? outcome.message : `${outcome.message} The Viewer now shows other content.`;
				return { message, snapshot, timedOut: outcome.timedOut, revealed };
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				return { message: `${outcome.message} There's no outline of the page after it: ${reason}`, timedOut: outcome.timedOut, revealed };
			}
		} finally {
			restoreFocus();
		}
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
	 * Takes a snapshot of the page. Its address comes from Positron, not from
	 * the bridge, which on Desktop runs in the page and so can be faked.
	 */
	private async snapshotOf(preview: PreviewWebview, options?: IViewerSnapshotOptions): Promise<IViewerSnapshot> {
		const { text, title, truncated } = await withBridgeTimeout(preview.webview.runBridge('snapshot', options));
		return { text, url: await this.currentUrl(preview) ?? '', title, truncated };
	}

	/**
	 * Gets the address of the page showing in the Viewer, as the browser has
	 * it, or else the one Positron last loaded.
	 */
	private async currentUrl(preview: PreviewWebview): Promise<string | undefined> {
		const url = await preview.webview.getCurrentUrl();
		if (url) {
			return cleanUrl(url);
		}
		if (preview instanceof PreviewUrl) {
			return uriToString(preview.currentUri);
		}
		return preview instanceof PreviewHtml ? uriToString(preview.uri) : undefined;
	}

	/**
	 * Makes sure the Viewer is showing and the app is laid out at its size,
	 * revealing the Viewer without focus if it's hidden.
	 *
	 * @returns Whether the Viewer had to be revealed.
	 */
	private async showViewer(preview: PreviewWebview): Promise<boolean> {
		// Make sure the page can be reached before changing the user's layout,
		// so a call that would fail anyway doesn't reveal the Viewer for nothing.
		const viewport = await withBridgeTimeout(preview.webview.runBridge('viewport'));
		const revealed = !this._viewsService.isViewVisible(POSITRON_PREVIEW_VIEW_ID);
		if (revealed) {
			await this._viewsService.openView(POSITRON_PREVIEW_VIEW_ID, false);
		}
		// Once revealed, the app has to lay itself out again, so measure again.
		await this.waitForLayout(preview, revealed ? undefined : viewport);
		return revealed;
	}

	/**
	 * Waits until the page in `preview` can be read and has settled: one an
	 * action went to, or content that opened in the Viewer during the action.
	 */
	private async waitForNewPage(preview: PreviewWebview): Promise<void> {
		// Until the new page takes over, a call can go to the old one, which is
		// going away and never answers (on Desktop), so keep each try short.
		const deadline = Date.now() + PAGE_LOAD_TIMEOUT_MS;
		for (; ;) {
			await timeout(250);
			if (this._previewService.activePreviewWebview !== preview) {
				// Other content replaced the page; the snapshot is of that instead.
				return;
			}
			try {
				await withTimeout(preview.webview.runBridge('viewport'), PAGE_PING_TIMEOUT_MS, 'The new page in the Viewer isn\'t responding.');
				break;
			} catch (error) {
				if (Date.now() >= deadline) {
					throw error;
				}
			}
		}
		await withBridgeTimeout(preview.webview.runBridge('waitForIdle'));
	}

	/**
	 * Throws if the Viewer moved on to other content during a call, which
	 * would otherwise return the old content as what's showing.
	 */
	private checkStillShowing(preview: PreviewWebview): void {
		if (this._previewService.activePreviewWebview !== preview) {
			throw new Error(VIEWER_CONTENT_CHANGED_MESSAGE);
		}
	}

	/**
	 * Waits until the app's viewport matches the Viewer's size on screen.
	 * Throws if it hasn't after LAYOUT_TIMEOUT_MS, rather than capturing the
	 * app at the wrong size.
	 *
	 * @param firstViewport The app's viewport, if it was just measured.
	 */
	private async waitForLayout(preview: PreviewWebview, firstViewport?: IViewerViewport): Promise<void> {
		const deadline = Date.now() + LAYOUT_TIMEOUT_MS;
		let viewport = firstViewport;
		for (; ;) {
			const rect = preview.webview.webview.container.getBoundingClientRect();
			viewport ??= await withBridgeTimeout(preview.webview.runBridge('viewport'));
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
					`not the Viewer's ${Math.round(rect.width)}x${Math.round(rect.height)}. Try again in a moment.`);
			}
			await timeout(100);
			viewport = undefined;
		}
	}
}
