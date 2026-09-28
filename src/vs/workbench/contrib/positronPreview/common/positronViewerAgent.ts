/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * What's showing in the Viewer.
 * - `url`: a web page or app loaded from a URL (Shiny, Streamlit, Dash, ...).
 * - `html`: an HTML file or string (htmlwidgets, local HTML files).
 * - `other`: something agents can't read yet, such as notebook renderer output.
 * - `none`: the Viewer is empty.
 */
export type ViewerContentKind = 'url' | 'html' | 'other' | 'none';

/**
 * Describes what's showing in the Viewer.
 */
export interface IViewerInfo {
	/** What's showing in the Viewer. */
	readonly kind: ViewerContentKind;
	/** The title of the Viewer's content, when known. */
	readonly title?: string;
	/** The URL loaded in the Viewer. In web builds it may be a proxied URL. */
	readonly url?: string;
	/** The ID of the runtime session that opened the content, when known. */
	readonly sourceSessionId?: string;
	/** Whether the Viewer is showing on screen. */
	readonly visible: boolean;
}

/**
 * Options for a snapshot of the Viewer's content.
 */
export interface IViewerSnapshotOptions {
	/** Only list the controls an agent can interact with. */
	readonly interactiveOnly?: boolean;
	/** A CSS selector limiting the snapshot to part of the page. */
	readonly selector?: string;
	/** The maximum length of the snapshot text, in characters. */
	readonly maxChars?: number;
}

/**
 * A text snapshot of the Viewer's content: an outline of the page with element
 * roles, names and key properties, and refs for the controls.
 */
export interface IViewerSnapshot {
	/** The outline of the page. */
	readonly text: string;
	/** The URL of the page. */
	readonly url: string;
	/** The title of the page. */
	readonly title: string;
	/** Whether the outline was cut short to fit `maxChars`. */
	readonly truncated: boolean;
}

/**
 * A screenshot of the Viewer's content.
 */
export interface IViewerScreenshot {
	readonly mimeType: 'image/png';
	/** The PNG image. */
	readonly data: VSBuffer;
	/** The width of the image, in pixels. */
	readonly width: number;
	/** The height of the image, in pixels. */
	readonly height: number;
	/**
	 * How the image was made: `native` is a real capture of the screen;
	 * `dom` is rebuilt from the page's content (web builds), which can miss
	 * WebGL content and images from other hosts.
	 */
	readonly method: 'native' | 'dom';
	/** Whether the Viewer had to be revealed to take the screenshot. */
	readonly revealed: boolean;
}

/**
 * Options for waiting until the app in the Viewer has settled.
 */
export interface IViewerIdleOptions {
	/** How long the page must go without DOM changes, in milliseconds. */
	readonly quietMs?: number;
	/** The longest to wait, in milliseconds. */
	readonly timeoutMs?: number;
}

/**
 * The result of waiting for the app in the Viewer to settle.
 */
export interface IViewerIdleResult {
	readonly waitedMs: number;
	readonly timedOut: boolean;
}

/**
 * The size of the app's viewport, in CSS pixels.
 */
export interface IViewerViewport {
	readonly width: number;
	readonly height: number;
}

/**
 * The bridge that runs against the app's window in the Viewer. See
 * `createViewerBridge`. Every argument and result is plain data, so calls can
 * cross into the app's frame on Desktop.
 */
export interface IViewerBridge {
	snapshot(options?: IViewerSnapshotOptions): IViewerSnapshot;
	waitForIdle(options?: IViewerIdleOptions): Promise<IViewerIdleResult>;
	viewport(): IViewerViewport;
}

export const IPositronViewerAgentService = createDecorator<IPositronViewerAgentService>('positronViewerAgentService');

/**
 * Gives AI agents read access to the content of the Viewer pane: what's
 * showing, a text snapshot of the page, and a screenshot.
 */
export interface IPositronViewerAgentService {
	readonly _serviceBrand: undefined;

	/**
	 * Describes what's showing in the Viewer.
	 */
	getViewerInfo(): IViewerInfo;

	/**
	 * Takes a text snapshot of the page in the Viewer, once the app has
	 * settled. Rejects with a message the agent can act on when there's nothing
	 * to snapshot.
	 */
	getViewerSnapshot(options?: IViewerSnapshotOptions): Promise<IViewerSnapshot>;

	/**
	 * Takes a screenshot of what's on screen in the Viewer. Reveals the
	 * Viewer first if it's hidden, without taking focus.
	 */
	getViewerScreenshot(): Promise<IViewerScreenshot>;
}
