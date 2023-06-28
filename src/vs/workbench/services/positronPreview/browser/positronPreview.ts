/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewService';
import { WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';

export const POSITRON_PREVIEW_VIEW_ID = 'workbench.panel.positronPreview';

export const POSITRON_PREVIEW_SERVICE_ID = 'positronPreviewService';

export const IPositronPreviewService = createDecorator<IPositronPreviewService>(POSITRON_PREVIEW_SERVICE_ID);

/**
 * IPositronPreviewService interface.
 */
export interface IPositronPreviewService {
	readonly _serviceBrand: undefined;

	/**
	 * Create and open a new preview.
	 */
	openPreview(
		webviewInitInfo: WebviewInitInfo,
		viewType: string,
		title: string,
		preserveFocus?: boolean): PreviewWebview;

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
