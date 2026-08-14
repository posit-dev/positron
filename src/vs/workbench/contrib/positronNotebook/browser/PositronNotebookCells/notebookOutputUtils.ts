/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCellOutputItem, NotebookCellOutputs } from './IPositronNotebookCell.js';
import { isDataExplorerMimeType } from '../getOutputContents.js';
import { isComplexHtml } from '../../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';

/**
 * Get the priority of a mime type for sorting purposes
 * @param mime The mime type to get the priority of
 * @returns A number representing the priority of the mime type. Lower numbers are higher priority.
 */
function getMimeTypePriority(mime: string): number | null {
	// Positron inline data explorer has highest priority
	if (isDataExplorerMimeType(mime)) {
		return 0;
	}

	if (mime.includes('application')) {
		return 1;
	}

	switch (mime) {
		case 'text/html':
			return 2;
		case 'text/latex':
			return 2.3;
		case 'text/markdown':
			return 2.5;
		case 'image/png':
		case 'image/svg+xml':
			return 3;
		case 'text/plain':
			return 4;
		default:
			// Dont know what this is, so mark it as special so we know something went wrong
			return null;
	}
}


/**
 * Pick the output item with the highest priority mime type from a cell output object
 * @param outputItems Array of outputs items data from a cell output object
 * @returns The output item with the highest priority mime type. If there's a tie, the first one is
 * returned. If there's an unknown mime type we defer to ones we do know about.
 */
export function pickPreferredOutputItem(outputItems: NotebookCellOutputItem[]): NotebookCellOutputItem | undefined {

	if (outputItems.length === 0) {
		return undefined;
	}

	let highestPriority: number | null = null;
	let preferredOutput = outputItems[0];

	for (const item of outputItems) {
		const priority = getMimeTypePriority(item.mime);

		// If we don't know how to render any of the mime types, we'll return the first one and hope
		// for the best!
		if (priority === null) {
			continue;
		}

		if (priority < (highestPriority ?? Infinity)) {
			preferredOutput = item;
			highestPriority = priority;
		}
	}

	if (highestPriority === null) {
		// Unknown mime mixes can occur in normal notebook usage.
		// We fall through to returning the first item, which is the
		// best we can do for unrecognized mime types.
	}

	return preferredOutput;
}

/**
 * Whether any of the given outputs renders through a webview (i.e. has a preload
 * message result). A webview output is a position:fixed overlay that is not
 * clipped by the output container, so the scrolling max-height must not be
 * applied to cells that contain one (it would overflow into neighboring cells).
 */
export function hasWebviewOutput(outputs: NotebookCellOutputs[]): boolean {
	return outputs.some(output => output.preloadMessageResult !== undefined);
}

/**
 * Where a piece of `text/html` output should be rendered:
 * - `webview`: active content (scripts, iframes, embeds, `javascript:` URLs, or
 *   inline event handlers) that must be isolated in a sandboxed webview overlay.
 * - `shadowRoot`: an inert full HTML document (`<!doctype>`, `<html>`, `<body>`)
 *   that renders inline in a shadow root so its document-level styles stay scoped.
 * - `fragment`: an inert HTML fragment that renders inline via `renderHtml`.
 */
export type HtmlRenderMode = 'webview' | 'shadowRoot' | 'fragment';

/**
 * Decide how to render a piece of `text/html` output. This is the single source of
 * truth for the routing both the model (webview vs inline) and the renderer
 * (shadow root vs fragment) depend on.
 *
 * Uses substring matching rather than a parser intentionally: a false positive only
 * routes to a webview (safe, still renders), while a false negative for active
 * content would be a security gap, so we prefer conservative detection.
 */
export function htmlRenderMode(html: string): HtmlRenderMode {
	if (isComplexHtml(html)) {
		return 'webview';
	}

	const lower = html.toLowerCase();
	const isFullDocument = lower.includes('<!doctype') ||
		lower.includes('<html') ||
		lower.includes('<body');

	return isFullDocument ? 'shadowRoot' : 'fragment';
}
