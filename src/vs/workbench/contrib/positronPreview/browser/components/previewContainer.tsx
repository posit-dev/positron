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

	const selectedItem = positronPreviewContext.previewWebviews.find(
		item => item.providedId === positronPreviewContext.selectedItemId);

	useEffect(() => {
		if (selectedItem && webviewRef.current) {
			const webview = selectedItem.webview;
			webview.claim(this, undefined);
			const container = webview.container;
			container.setAttribute('data-preview-container', selectedItem.providedId);
			if (container) {
				webview.layoutWebviewOverElement(webviewRef.current);
			}
		}
	});

	const style = {
		width: `${props.width}px`,
		height: `${props.height}px`,
	};

	return (
		<div ref={webviewRef} style={style}>
		</div>
	);
};
