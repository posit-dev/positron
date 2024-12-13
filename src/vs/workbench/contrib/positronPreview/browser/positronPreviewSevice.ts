/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PreviewHtml } from './previewHtml.js';
import { PreviewWebview } from './previewWebview.js';
import { WebviewExtensionDescription, WebviewInitInfo } from '../../webview/browser/webview.js';
import { IShowHtmlUriEvent } from '../../../services/languageRuntime/common/languageRuntimeUiClient.js';

export const POSITRON_PREVIEW_VIEW_ID = 'workbench.panel.positronPreview';

export const POSITRON_PREVIEW_SERVICE_ID = 'positronPreviewService';

/**
 * The unique viewType that identifies Positron URL previews.
 */
export const POSITRON_PREVIEW_URL_VIEW_TYPE = 'positron.previewUrl';

/**
 * The unique viewType that identifies Positron HTML previews.
 */
export const POSITRON_PREVIEW_HTML_VIEW_TYPE = 'positron.previewHtml';

export const IPositronPreviewService = createDecorator<IPositronPreviewService>(POSITRON_PREVIEW_SERVICE_ID);

/**
 * IPositronPreviewService interface.
 *
 * Note that this service lives in `/contrib/` instead of `/services/` because
 * it requires a large number of types from the `webview` package, which can
 * only be referenced from `/contrib/` due to VS Code's code layering rules.
 */
export interface IPositronPreviewService {
	readonly _serviceBrand: undefined;

	/**
	 * Create and open a new preview.
	 */
	openPreview(
		previewId: string,
		webviewInitInfo: WebviewInitInfo,
		viewType: string,
		title: string,
		preserveFocus?: boolean): PreviewWebview;

	/**
	 * Opens a URI in the preview pane.
	 *
	 * @param previewId The unique ID or handle of the preview.
	 * @param extension The extension that is opening the URL.
	 * @param uri The URI to open in the preview.
	 */
	openUri(
		previewId: string,
		extension: WebviewExtensionDescription | undefined,
		uri: URI): PreviewWebview;

	/**
	 * Opens an HTML file in the preview pane.
	 *
	 * @param previewId The unique ID or handle of the preview.
	 * @param extension The extension that is opening the URL.
	 * @param path The path to the HTML file.
	 */
	openHtml(
		previewId: string,
		extension: WebviewExtensionDescription | undefined,
		path: string): Promise<PreviewWebview>;

	/**
	 * Opens an HTML file from a runtime message in the preview pane. This
	 * method just creates and returns the preview; it doesn't show it in the
	 * pane. Used by the Plots service to create a webview for an interactive
	 * plot.
	 *
	 * @param sessionId The session ID of the preview.
	 * @param extension The extension that is opening the URL.
	 * @param uri The URI to open in the preview.
	 */
	createHtmlWebview(
		sessionId: string,
		extension: WebviewExtensionDescription | undefined,
		event: IShowHtmlUriEvent): PreviewHtml;

	/**
	 * An event that is fired when a new preview panel webview is created.
	 */
	onDidCreatePreviewWebview: Event<PreviewWebview>;

	/**
	 * An event that is fired when the active preview pane item changes.
	 */
	onDidChangeActivePreviewWebview: Event<string>;

	/**
	 * Returns the list of preview pane items currently being displayed in the
	 * preview pane.
	 */
	get previewWebviews(): PreviewWebview[];

	/**
	 * Clears all the previews from the preview pane.
	 */
	clearAllPreviews(): void;

	/**
	 * Returns the active preview pane item, or undefined if the preview pane
	 * is empty.
	 */
	get activePreviewWebview(): PreviewWebview | undefined;

	get activePreviewWebviewId(): string;

	set activePreviewWebviewId(id: string);

	openEditor(uri: URI, title?: string): Promise<void>;

	editorWebview(editorId: string): PreviewWebview | undefined;

	editorTitle(previewId: string): string | undefined;

	disposeEditor(previewId: string): void;
}
