/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { POSITRON_PREVIEW_URL_VIEW_TYPE } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * PreviewUrl is a class that represents a Positron `PreviewWebview` that
 * contains a URL preview.
 */
export class PreviewUrl extends PreviewWebview {

	/**
	 * Construct a new PreviewWebview.
	 *
	 * @param previewId A unique ID for the preview
	 * @param webview The underlying webview instance that hosts the preview's content
	 * @param uri The URI to open in the preview
	 */
	constructor(
		previewId: string,
		webview: IOverlayWebview,
		private readonly uri: URI
	) {
		super(POSITRON_PREVIEW_URL_VIEW_TYPE, previewId,
			POSITRON_PREVIEW_URL_VIEW_TYPE,
			webview);

		webview.setHtml(`
<html>
	<head>
		<style>
			html, body {
				padding: 0;
				margin: 0;
				height: 100%;
				min-height: 100%;
			}

			iframe {
				width: 100%;
				height: 100%;
				border: none;
			}
		</style>
	</head>
	<body>
		<iframe src="${uri.toString()}"></iframe>
	</body>
</html>`);
	}

	get currentUri(): URI {
		return this.uri;
	}
}
