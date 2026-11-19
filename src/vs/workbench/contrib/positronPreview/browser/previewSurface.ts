/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IViewerBridge, IViewerRect } from '../common/positronViewerAgent.js';
import { IElementData } from '../../../../platform/browserView/common/browserView.js';
import { IViewerCapture } from './viewerScreenshot.js';

export type ViewerBridgeResult<M extends keyof IViewerBridge> = Awaited<ReturnType<IViewerBridge[M]>>;

export const VIEWER_CONTENT_CHANGED_MESSAGE = 'The Viewer\'s content changed while it was being read. Try again.';

export const FULL_PAGE_UNAVAILABLE_MESSAGE = 'A full-page screenshot is available only when the Viewer uses the integrated browser.';

export const BROWSER_ONLY_MESSAGE = 'This is available only when the Viewer uses the integrated browser.';

export const CONSOLE_LOGS_UNAVAILABLE_MESSAGE = 'Console logs are available only when the Viewer uses the integrated browser.';

/**
 * A step of input sent to the page from outside it, so the page gets it as it
 * would from a user (trusted events, with the browser's default actions).
 * Points are in the page's viewport, in CSS pixels.
 */
export type ViewerInputStep =
	| { readonly type: 'mouse'; readonly action: 'move' | 'down' | 'up'; readonly x: number; readonly y: number; readonly button?: 'left' | 'right' | 'middle'; readonly clickCount?: number }
	/** A key or combination, such as `Enter` or `Control+a`, pressed and released. */
	| { readonly type: 'key'; readonly key: string }
	/** Text typed one character at a time. */
	| { readonly type: 'text'; readonly text: string };

export interface IPreviewCaptureOptions {
	readonly rect?: IViewerRect;
	readonly fullPage?: boolean;
}

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

	/** Whether the page can go back or forward, or undefined when the surface can't tell. */
	readonly canGoBack: boolean | undefined;
	readonly canGoForward: boolean | undefined;

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

	/**
	 * Takes a screenshot of the page's viewport, or the part of it in `rect`,
	 * or with `fullPage`, of the whole page (the integrated browser only). The
	 * content must be showing.
	 */
	captureScreenshot(options?: IPreviewCaptureOptions): Promise<IViewerCapture>;

	/** Gets the address of the page showing, as the browser has it. */
	getCurrentUrl(): Promise<string | undefined>;

	/** Gets the page's console messages. Rejects for a webview, which doesn't keep them. */
	getConsoleLogs(): Promise<string>;

	/** Sends input to the page from outside it. Only the integrated browser can. */
	dispatchInput?(steps: readonly ViewerInputStep[]): Promise<void>;

	/** Shows the find widget for the page. */
	find(): void;

	/** Opens or closes the developer tools for the page. Rejects for a webview. */
	toggleDevTools(): Promise<void>;

	/**
	 * Lets the user pick an element in the page (`select`), or keep commenting
	 * on elements (`comment`), or stops if that's already on. Rejects for a
	 * webview.
	 */
	toggleElementSelection(mode: 'select' | 'comment'): Promise<void>;

	/** Fires when the user picks an element or comments on one. */
	readonly onDidSelectElement: Event<IElementData>;

	/** Removes the pin a comment left on an element in the page. */
	discardElementComment(elementId: string): void;
}
