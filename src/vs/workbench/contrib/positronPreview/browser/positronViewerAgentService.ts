/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout, timeout } from '../../../../base/common/async.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { getMediaOrTextMime } from '../../../../base/common/mime.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { isFileExcludedFromAI } from '../../chat/browser/tools/utils.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { PreviewSourceType } from '../../../services/languageRuntime/common/positronUiComm.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { IPositronViewerAgentService, IViewerActOutcome, IViewerActResult, IViewerDialog, IViewerDialogPolicy, IViewerFile, IViewerInfo, IViewerScreenshot, IViewerScreenshotOptions, IViewerSnapshot, IViewerSnapshotOptions, IViewerViewport, ViewerAction, ViewerContentKind } from '../common/positronViewerAgent.js';
import { actWithTrustedInput } from './viewerTrustedInput.js';
import { IPositronPreviewService, POSITRON_PREVIEW_HTML_VIEW_TYPE, POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE, POSITRON_PREVIEW_VIEW_ID } from './positronPreviewSevice.js';
import { PreviewHtml } from './previewHtml.js';
import { VIEWER_CONTENT_CHANGED_MESSAGE } from './previewSurface.js';
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

/** The most an agent may upload in one action, in bytes. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** How to describe the dialogs a page showed during an action. */
function dialogsMessage(shown: readonly IViewerDialog[], policy: IViewerDialogPolicy): string {
	return shown.map(dialog => {
		const answer = dialog.type === 'alert' ? 'dismissed' :
			!policy.accept ? 'cancelled' :
				dialog.type === 'prompt' ? `answered with ${JSON.stringify(policy.promptText ?? '')}` : 'accepted';
		return ` The page showed a ${dialog.type} dialog, ${JSON.stringify(dialog.message)}, which was ${answer}.`;
	}).join('');
}

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

function contentKindOf(preview: PreviewWebview | undefined): ViewerContentKind {
	if (!preview) {
		return 'none';
	}
	if (preview instanceof PreviewUrl) {
		return 'url';
	}
	// HTML files (PreviewHtml) and HTML strings shown with openHtmlString, such
	// as Quarto output opened in the Viewer.
	if (preview.viewType === POSITRON_PREVIEW_HTML_VIEW_TYPE) {
		return 'html';
	}
	// Widgets and other output from a console session or a Quarto chunk.
	if (preview.viewType === POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE) {
		return 'output';
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

	/** How dialogs are answered during actions, as an agent last set it. */
	private _dialogPolicy: IViewerDialogPolicy = { accept: true };

	private _previewCounter = 0;

	constructor(
		@IPositronPreviewService private readonly _previewService: IPositronPreviewService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) { }

	async getViewerInfo(): Promise<IViewerInfo> {
		this.checkEnabled();
		const visible = this._viewsService.isViewVisible(POSITRON_PREVIEW_VIEW_ID);
		const preview = this._previewService.activePreviewWebview;
		const kind = contentKindOf(preview);
		if (!preview) {
			return { kind, visible };
		}
		const title = preview.surface.title;
		const backend = preview.surface.kind;
		if (preview instanceof PreviewUrl) {
			const source = preview.source;
			return {
				kind,
				title,
				url: await this.currentUrl(preview),
				sourceSessionId: source?.type === PreviewSourceType.Runtime ? source.id : undefined,
				visible,
				backend,
			};
		}
		if (preview instanceof PreviewHtml) {
			return {
				kind,
				title: title || preview.html?.title || undefined,
				url: await this.currentUrl(preview),
				sourceSessionId: preview.sessionId || undefined,
				visible,
				backend,
			};
		}
		return { kind, title: title || preview.name, visible, backend };
	}

	async getViewerSnapshot(options?: IViewerSnapshotOptions): Promise<IViewerSnapshot> {
		this.checkEnabled();
		const preview = this.readablePreview();
		// Snapshot once the app has settled: a snapshot taken while Streamlit is
		// still rendering comes back empty.
		await withBridgeTimeout(preview.surface.runBridge('waitForIdle'));
		const snapshot = await this.snapshotOf(preview, options);
		this.checkStillShowing(preview);
		return snapshot;
	}

	async getViewerScreenshot(options?: IViewerScreenshotOptions): Promise<IViewerScreenshot> {
		this.checkEnabled();
		const preview = this.readablePreview();
		const target = options?.ref !== undefined || options?.selector !== undefined ? { ref: options.ref, selector: options.selector } : undefined;
		if (target && options?.fullPage) {
			throw new Error('Take a screenshot of an element or of the whole page, not both.');
		}

		// The Viewer has to be showing: Desktop captures the screen.
		const revealed = await this.showViewer(preview);
		await withBridgeTimeout(preview.surface.runBridge('waitForIdle'));
		const rect = target ? await withBridgeTimeout(preview.surface.runBridge('locate', target, { scrollIntoView: options?.scrollIntoView })) : undefined;

		const capture = await withTimeout(preview.surface.captureScreenshot({ rect, fullPage: options?.fullPage }), CAPTURE_TIMEOUT_MS,
			'Taking the screenshot of the Viewer took too long.');
		this.checkStillShowing(preview);
		return { mimeType: 'image/png', ...capture, revealed };
	}

	async viewerAct(action: ViewerAction, snapshotOptions?: IViewerSnapshotOptions): Promise<IViewerActResult> {
		this.checkEnabled();
		if (action.kind === 'navigate') {
			return this.navigate(action, snapshotOptions);
		}
		if (action.kind === 'handleDialog') {
			this._dialogPolicy = { accept: action.accept !== false, promptText: typeof action.promptText === 'string' ? action.promptText : undefined };
			const how = !this._dialogPolicy.accept ? 'cancelled' :
				this._dialogPolicy.promptText !== undefined ? `accepted, and prompts answered with ${JSON.stringify(this._dialogPolicy.promptText)}` : 'accepted';
			return { message: `Dialogs the page shows during your actions will be ${how}.`, timedOut: false, revealed: false };
		}
		if (action.kind === 'upload') {
			action = { ...action, paths: undefined, files: await this.readFiles(action.paths) };
		}
		const preview = this.readablePreview();
		// Acting on a control in the app's page focuses the Viewer, which would
		// send what the user types to the app.
		const restoreFocus = preview.surface.keepFocusOutside();
		try {
			// Act on the app at the size the user sees it. A responsive app can
			// hide or move its controls at a hidden web Viewer's 300x150.
			const revealed = await this.showViewer(preview);
			let outcome: IViewerActOutcome;
			let movedOn = false;
			try {
				outcome = await withTimeout(this.perform(preview, action), ACT_TIMEOUT_MS,
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

	async getViewerConsoleLogs(): Promise<string> {
		this.checkEnabled();
		return withBridgeTimeout(this.readablePreview().surface.getConsoleLogs());
	}

	async viewerEvaluate(expression: string, timeoutMs?: number): Promise<string> {
		this.checkEnabled();
		const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? Math.min(timeoutMs, BRIDGE_CALL_TIMEOUT_MS) : BRIDGE_CALL_TIMEOUT_MS;
		return withTimeout(this.readablePreview().surface.runBridge('evaluate', expression), limit,
			`The expression didn't finish within ${limit} ms.`);
	}

	/**
	 * Takes an action, with input from outside the page when the surface can
	 * send it, and answers the dialogs the page shows meanwhile by the policy.
	 */
	private async perform(preview: PreviewWebview, action: ViewerAction): Promise<IViewerActOutcome> {
		const surface = preview.surface;
		const policy = this._dialogPolicy;
		await surface.runBridge('dialogs', policy);
		let outcome: IViewerActOutcome;
		try {
			outcome = await actWithTrustedInput(surface, action) ?? await surface.runBridge('act', action);
		} catch (error) {
			surface.runBridge('dialogs', null).catch(() => { });
			throw error;
		}
		// The page is gone after a navigation, and its dialogs with it.
		const shown = outcome.navigated ? [] : await surface.runBridge('dialogs', null).catch(() => []);
		return shown.length ? { ...outcome, message: outcome.message + dialogsMessage(shown, policy) } : outcome;
	}

	/**
	 * Goes to a URL, back, forward, or reloads, waits for the page to load,
	 * and returns a fresh outline.
	 */
	private async navigate(action: Extract<ViewerAction, { kind: 'navigate' }>, snapshotOptions?: IViewerSnapshotOptions): Promise<IViewerActResult> {
		const preview = this._previewService.activePreviewWebview;
		let target: PreviewWebview;
		let done: string;
		let start: () => void;
		if (action.type === 'url') {
			const uri = await this.agentUrl(action.url);
			if (preview instanceof PreviewUrl) {
				target = preview;
				start = () => preview.navigateToUri(uri);
			} else {
				target = this._previewService.openUri(`agentPreview-${this._previewCounter++}`, undefined, uri);
				start = () => { };
			}
			done = `Went to ${uri.toString(true)}.`;
		} else if (action.type === 'back' || action.type === 'forward' || action.type === 'reload') {
			if (!preview?.address) {
				throw new Error(preview ? 'The Viewer\'s content has no address, so it can\'t go back, forward or reload.' : 'Nothing is showing in the Viewer.');
			}
			target = preview;
			const surface = preview.surface;
			start = action.type === 'back' ? () => surface.goBack() : action.type === 'forward' ? () => surface.goForward() : () => surface.reload();
			done = action.type === 'back' ? 'Went back.' : action.type === 'forward' ? 'Went forward.' : 'Reloaded the page.';
		} else {
			throw new Error('navigate needs a type: url, back, forward or reload.');
		}
		const loaded = Event.toPromise(target.surface.onDidLoad);
		start();
		const didLoad = await raceTimeout(loaded.then(() => true), PAGE_LOAD_TIMEOUT_MS, () => loaded.cancel()) === true;
		if (!didLoad) {
			return {
				message: `${done.slice(0, -1)}, but no page finished loading within ${PAGE_LOAD_TIMEOUT_MS / 1000} seconds${action.type === 'back' || action.type === 'forward' ? ' (there may be no page to go to)' : ''}.`,
				timedOut: true,
				revealed: false,
			};
		}
		try {
			await this.waitForNewPage(target);
			const current = this.readablePreview();
			return { message: done, snapshot: await this.snapshotOf(current, snapshotOptions), timedOut: false, revealed: false };
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return { message: `${done} There's no outline of the page after it: ${reason}`, timedOut: false, revealed: false };
		}
	}

	/** Checks a URL an agent gave, and resolves it so localhost works remotely. */
	private async agentUrl(url: unknown): Promise<URI> {
		if (typeof url !== 'string' || !url) {
			throw new Error('Going to a URL needs the url.');
		}
		let uri = URI.parse(url.includes('://') ? url : `http://${url}`);
		if (uri.scheme !== 'http' && uri.scheme !== 'https') {
			throw new Error(`The Viewer only opens http and https URLs, not ${JSON.stringify(url)}.`);
		}
		try {
			uri = (await this._openerService.resolveExternalUri(uri)).resolved;
		} catch {
			// Use the URL as given.
		}
		return uri;
	}

	/**
	 * Reads files an agent wants to upload. They must be in the workspace and
	 * not excluded from AI, since a page could ask an agent for any file.
	 */
	private async readFiles(paths: unknown): Promise<IViewerFile[]> {
		if (!Array.isArray(paths) || !paths.length || !paths.every(path => typeof path === 'string' && path)) {
			throw new Error('upload needs the paths of the files to attach.');
		}
		const folder = this._workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			throw new Error('Files can only be uploaded from the workspace, and no folder is open.');
		}
		const files: IViewerFile[] = [];
		let total = 0;
		for (const path of paths as string[]) {
			const absolute = path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path);
			const uri = absolute ? URI.file(path).with({ scheme: folder.uri.scheme, authority: folder.uri.authority }) : joinPath(folder.uri, path);
			if (!this._workspaceContextService.isInsideWorkspace(uri)) {
				throw new Error(`${JSON.stringify(path)} is outside the workspace. Agents can only upload files from the workspace.`);
			}
			if (isFileExcludedFromAI(this._configurationService, uri.path)) {
				throw new Error(`${JSON.stringify(path)} is excluded from AI features, so it can't be uploaded.`);
			}
			const content = await this._fileService.readFile(uri);
			total += content.value.byteLength;
			if (total > MAX_UPLOAD_BYTES) {
				throw new Error(`The files are larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB, the most an agent can upload at once.`);
			}
			files.push({ name: content.name, type: getMediaOrTextMime(content.name) ?? 'application/octet-stream', data: encodeBase64(content.value) });
		}
		return files;
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
			throw new Error('Agents can\'t read this kind of Viewer content, such as a preview from an extension.');
		}
		return preview;
	}

	/**
	 * Takes a snapshot of the page. Its address comes from Positron, not from
	 * the bridge, which on Desktop runs in the page and so can be faked.
	 */
	private async snapshotOf(preview: PreviewWebview, options?: IViewerSnapshotOptions): Promise<IViewerSnapshot> {
		const { text, title, truncated } = await withBridgeTimeout(preview.surface.runBridge('snapshot', options));
		return { text, url: await this.currentUrl(preview) ?? '', title, truncated };
	}

	/**
	 * Gets the address of the page showing in the Viewer, as the browser has
	 * it, or else the one Positron last loaded. HTML strings and output have
	 * none worth reporting (`about:srcdoc` or the webview's own address).
	 */
	private async currentUrl(preview: PreviewWebview): Promise<string | undefined> {
		if (!(preview instanceof PreviewUrl || preview instanceof PreviewHtml)) {
			return undefined;
		}
		const url = await preview.surface.getCurrentUrl();
		if (url) {
			return cleanUrl(url);
		}
		return uriToString(preview instanceof PreviewUrl ? preview.currentUri : preview.uri);
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
		const viewport = await withBridgeTimeout(preview.surface.runBridge('viewport'));
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
				await withTimeout(preview.surface.runBridge('viewport'), PAGE_PING_TIMEOUT_MS, 'The new page in the Viewer isn\'t responding.');
				break;
			} catch (error) {
				if (Date.now() >= deadline) {
					throw error;
				}
			}
		}
		await withBridgeTimeout(preview.surface.runBridge('waitForIdle'));
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
			const rect = preview.surface.getBounds() ?? new DOMRect();
			viewport ??= await withBridgeTimeout(preview.surface.runBridge('viewport'));
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
