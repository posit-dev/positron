/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IViewerBridge } from '../common/positronViewerAgent.js';
import { IViewerCapture } from './viewerScreenshot.js';

export type ViewerBridgeResult<M extends keyof IViewerBridge> = Awaited<ReturnType<IViewerBridge[M]>>;

export const VIEWER_CONTENT_CHANGED_MESSAGE = 'The Viewer\'s content changed while it was being read. Try again.';

export const CONSOLE_LOGS_UNAVAILABLE_MESSAGE = 'Console logs are available only when the Viewer uses the integrated browser.';

/**
 * What the Viewer needs from the thing that shows a preview's content: a
 * webview, or (on Desktop) the integrated browser.
 */
export interface IPreviewSurface extends IDisposable {
	readonly kind: 'webview' | 'browser';

	/** The title of the page showing, if it has one. */
	readonly title: string | undefined;

	/** Fires when a page finishes loading, with its title. */
	readonly onDidLoad: Event<string>;
	readonly onDidNavigate: Event<URI>;
	readonly onDidDispose: Event<void>;

	loadUri(uri: URI): void;
	goBack(): void;
	goForward(): void;
	reload(): void;
	setTitle(title: string): void;

	/** Shows the content over `anchor`, on behalf of `owner`. */
	claim(owner: unknown, anchor: HTMLElement): void;

	/** Hides the content, if `owner` still holds it. */
	release(owner: unknown): void;

	/** Moves the content to its anchor's current position and size. */
	layout(): void;

	/** Gets the content's position and size on screen. */
	getBounds(): DOMRect | undefined;

	/**
	 * Notes where keyboard focus is, and returns a function that takes it
	 * back out of the content if an action in the page moved it there.
	 */
	keepFocusOutside(): () => void;

	/** Calls a Viewer bridge method against the page showing. */
	runBridge<M extends keyof IViewerBridge>(method: M, ...args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>>;

	/** Takes a screenshot of the page. The content must be showing. */
	captureScreenshot(): Promise<IViewerCapture>;

	/** Gets the address of the page showing, as the browser has it. */
	getCurrentUrl(): Promise<string | undefined>;

	/** Gets the page's console messages. Rejects for a webview, which doesn't keep them. */
	getConsoleLogs(): Promise<string>;
}
