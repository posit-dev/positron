/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCellOutputItem, NotebookCellOutputs } from './IPositronNotebookCell.js';
import { isDataExplorerMimeType } from '../getOutputContents.js';
import { isComplexHtml } from '../../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';
import { IOrderedMimeType, RENDERER_NOT_AVAILABLE } from '../../../notebook/common/notebookCommon.js';

/**
 * Whether Positron notebooks render this mime type natively inline. This is the
 * set of mime types `parseOutputData` (getOutputContents.ts) knows how to parse
 * into a renderable output.
 */
function isNativelyRenderedMime(mime: string): boolean {
	if (isDataExplorerMimeType(mime)) {
		return true;
	}

	switch (mime) {
		case 'application/json':
		case 'application/vnd.code.notebook.stdout':
		case 'application/vnd.code.notebook.stderr':
		case 'application/vnd.code.notebook.error':
		case 'text/html':
		case 'text/latex':
		case 'text/markdown':
		case 'text/plain':
		case 'image/png':
		case 'image/svg+xml':
			return true;
		default:
			return false;
	}
}

/** The output item selected for rendering from a multi-mime output bundle. */
export interface PreferredOutputItem {
	/** The output item to parse and render. */
	item: NotebookCellOutputItem;

	/**
	 * ID of the registered notebook renderer extension that should render the
	 * item. Only set when Positron does not render the mime type natively; the
	 * caller routes such items to the renderer-runtime webview.
	 */
	rendererId?: string;
}

/**
 * Pick the output item to render from a cell output's mime bundle.
 *
 * Walks the renderer-registry ordering (`INotebookService.getMimeTypeInfo`,
 * the same machinery the upstream notebook editor uses) and picks the first
 * mime type that either renders natively or has a registered notebook renderer
 * extension. This means an unrenderable custom mime (e.g.
 * `application/3dmoljs_load.v0`) never beats a renderable fallback like
 * `text/html` -- the old hardcoded priority list preferred any `application/*`
 * mime and errored on such bundles.
 *
 * @param outputItems Array of output items from a cell output object.
 * @param orderedMimeTypes The output's mime types ordered by the notebook
 *   renderer registry (renderer-less mime types sort last).
 * @returns The preferred output item, or `undefined` if there are no items.
 *   When no mime type is renderable, the first item is returned so the caller
 *   can surface an actionable message.
 */
export function resolvePreferredOutputItem(
	outputItems: NotebookCellOutputItem[],
	orderedMimeTypes: readonly IOrderedMimeType[],
): PreferredOutputItem | undefined {
	if (outputItems.length === 0) {
		return undefined;
	}

	// The Positron inline data explorer always wins. Its mime type deliberately
	// has no registered notebook renderer, so the registry ordering would push
	// it behind renderable mime types like text/html.
	const dataExplorerItem = outputItems.find(item => isDataExplorerMimeType(item.mime));
	if (dataExplorerItem) {
		return { item: dataExplorerItem };
	}

	for (const mimeTypeInfo of orderedMimeTypes) {
		const item = outputItems.find(item => item.mime === mimeTypeInfo.mimeType);
		if (!item) {
			continue;
		}
		if (isNativelyRenderedMime(item.mime)) {
			return { item };
		}
		if (mimeTypeInfo.rendererId !== RENDERER_NOT_AVAILABLE && mimeTypeInfo.isTrusted) {
			return { item, rendererId: mimeTypeInfo.rendererId };
		}
	}

	// Unknown mime mixes can occur in normal notebook usage. Return the first
	// item so parseOutputData surfaces its unknown-mime message.
	return { item: outputItems[0] };
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
