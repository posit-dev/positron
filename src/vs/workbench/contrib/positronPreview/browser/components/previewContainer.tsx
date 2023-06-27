/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { usePositronPreviewContext } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewContext';

/**
 * PreviewContainerProps interface.
 */
interface PreviewContainerProps {
	width: number;
	height: number;
}

/**
 * PreviewContainer component; holds the preview items.
 *
 * @param props A PreviewContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PreviewContainer = (props: PreviewContainerProps) => {

	const positronPreviewContext = usePositronPreviewContext();
	const webviewRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		// Empty for now.
	});

	const selectedItem = positronPreviewContext.previewWebviews.find(
		item => item.providedId === positronPreviewContext.selectedItemId);

	if (selectedItem && webviewRef.current) {
		selectedItem.webview.layoutWebviewOverElement(webviewRef.current);
	}

	// If there are no plot instances, show a placeholder; otherwise, show the
	// most recently generated plot.
	return (
		<div>
			<h1>Hello, world!</h1>
			<p>Number of items: {positronPreviewContext.previewWebviews.length}</p>
			<p>Selected item: {positronPreviewContext.selectedItemIndex}</p>
			<div ref={webviewRef}></div>
		</div>
	);
};
