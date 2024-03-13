/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { WebviewExtensionDescription, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';

export const POSITRON_PREVIEW_VIEW_ID = 'workbench.panel.positronPreview';

export const POSITRON_PREVIEW_SERVICE_ID = 'positronPreviewService';

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
	 * Opens a URL in the preview pane.
	 *
	 * @param url The URL to open in the preview.
	 */
	openUrl(previewId: string,
		origin: string,
		extension: WebviewExtensionDescription,
		uri: URI): PreviewWebview;

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
	 * Returns the active preview pane item, or undefined if the preview pane
	 * is empty.
	 */
	get activePreviewWebview(): PreviewWebview | undefined;

	get activePreviewWebviewId(): string;

	set activePreviewWebviewId(id: string);
}
