/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

// --- Start Positron ---
import { VSBuffer } from '../../../base/common/buffer.js';
// --- End Positron ---

export const IWebviewManagerService = createDecorator<IWebviewManagerService>('webviewManagerService');

export interface WebviewWebContentsId {
	readonly webContentsId: number;
}

export interface WebviewWindowId {
	readonly windowId: number;
}

// --- Start Positron ---
/**
 * A unique composite identifier for a frame inside a webview.
 */
export interface WebviewFrameId {
	/** The process ID that backs the frame */
	readonly processId: number;

	/** The frame's routing identifier */
	readonly routingId: number;

	/**
	 * The frame's place in the frame tree. Unlike the process and routing IDs,
	 * it stays the same when the frame goes to another document.
	 */
	readonly frameTreeNodeId?: number;
}

/**
 * How the error from `executeJavaScript` starts when the frame is gone. It's
 * thrown before the script runs, so a caller can find the frame again and
 * retry without running the script twice.
 */
export const WEBVIEW_FRAME_NOT_FOUND_MESSAGE = 'No frame found';

/**
 * An event fired when a webview's content frame navigates.
 */
export interface FrameNavigationEvent {
	/** The ID of the webview whose content frame navigated */
	readonly webviewId: string;

	/** The ID of the frame that navigated */
	readonly frameId: WebviewFrameId;

	/** The frame's new URL */
	readonly url: string;

	/** Whether the frame stayed on its document, as with pushState or a #hash link */
	readonly isSameDocument: boolean;

	/** Whether the frame failed to load the URL and shows an error page instead */
	readonly isErrorPage: boolean;
}

export interface WebviewRectangle {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
// --- End Positron ---

export interface FindInFrameOptions {
	readonly forward?: boolean;
	readonly findNext?: boolean;
	readonly matchCase?: boolean;
}

export interface FoundInFrameResult {
	readonly requestId: number;
	readonly activeMatchOrdinal: number;
	readonly matches: number;
	readonly finalUpdate: boolean;
}

// --- Start Positron ---
/**
 * The window-wide suppression target and the webview claiming or releasing it.
 */
export type WebviewMenuShortcutsTarget = (WebviewWebContentsId | WebviewWindowId) & {
	readonly webviewId: string;
};
// --- End Positron ---

export interface IWebviewManagerService {
	_serviceBrand: unknown;

	readonly onFoundInFrame: Event<FoundInFrameResult>;

	// --- Start Positron ---
	// setIgnoreMenuShortcuts(id: WebviewWebContentsId | WebviewWindowId, enabled: boolean): Promise<void>;
	/** Focus replaces the target's owner; blur/disposal only releases the same owner. */
	setIgnoreMenuShortcuts(id: WebviewMenuShortcutsTarget, enabled: boolean): Promise<void>;
	// --- End Positron ---

	/** Requests for unavailable hosts or frames are ignored. */
	findInFrame(id: WebviewWebContentsId | WebviewWindowId, frameName: string, text: string, options: FindInFrameOptions): Promise<void>;

	/** Requests for unavailable hosts or frames are ignored. */
	stopFindInFrame(id: WebviewWebContentsId | WebviewWindowId, frameName: string, options: { keepSelection?: boolean }): Promise<void>;

	// --- Start Positron ---
	/**
	 * Starts firing `onFrameNavigation` for the webviews in a window.
	 *
	 * @param windowId The window id of the webviews.
	 */
	trackFrameNavigation(windowId: WebviewWindowId): Promise<void>;

	/**
	 * An event fired when a webview's content frame has navigated.
	 */
	onFrameNavigation: Event<FrameNavigationEvent>;

	/**
	 * Capture a snapshot of the contents of a webview as a PNG image.
	 *
	 * @param windowId The window id of the webview to capture.
	 * @param area The area of the webview to capture, in CSS pixels.
	 */
	captureContentsAsPng(windowId: WebviewWindowId, area?: WebviewRectangle): Promise<VSBuffer | undefined>;

	/**
	 * Execute JavaScript code in a webview frame.
	 *
	 * @param frameId The ID of the frame in which to execute the code.
	 * @param code The code to execute.
	 *
	 * @returns A promise that resolves to the result of the code execution.
	 */
	executeJavaScript(frameId: WebviewFrameId, code: string): Promise<any>;

	/**
	 * Gets the URL of a webview frame, as the browser has it. It follows the
	 * page's history changes, and the page can't fake it.
	 *
	 * @param frameId The ID of the frame.
	 *
	 * @returns The frame's URL, or undefined if the frame is gone.
	 */
	getFrameUrl(frameId: WebviewFrameId): Promise<string | undefined>;

	/**
	 * Gets the ID of a webview's host frame, the one running the webview's own
	 * index.html. Content set with `setHtml` is written into a frame inside it,
	 * which has no ID of its own that Positron knows.
	 *
	 * @param webviewId The webview's ID.
	 *
	 * @returns The frame's ID, or undefined if the webview has no frame.
	 */
	getWebviewHostFrameId(webviewId: string): Promise<WebviewFrameId | undefined>;
	// --- End Positron ---
}
