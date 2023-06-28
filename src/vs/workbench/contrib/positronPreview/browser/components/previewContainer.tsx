/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { usePositronPreviewContext } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewContext';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * PreviewContainerProps interface.
 */
interface PreviewContainerProps {
	selectedItemId: string;
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
	let webview: IOverlayWebview | undefined = undefined;

	useEffect(() => {
		const selectedItem = positronPreviewContext.previewWebviews.find(
			item => item.providedId === props.selectedItemId);

		if (selectedItem) {
			webview = selectedItem.webview;
			webview.claim(this, undefined);
			return () => {
				webview?.release(this);
			};
		}
		return () => { };
	}, [props.selectedItemId]);

	useEffect(() => {
		if (webview && webviewRef.current) {
			webview.layoutWebviewOverElement(webviewRef.current);
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
