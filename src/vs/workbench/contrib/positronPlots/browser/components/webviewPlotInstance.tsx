/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect } from 'react';

// Other dependencies.
import { WebviewPlotClient } from '../webviewPlotClient.js';

/**
 * WebviewPlotInstanceProps interface.
 */
interface WebviewPlotInstanceProps {
	width: number;
	height: number;
	visible: boolean;
	plotClient: WebviewPlotClient;
}

/**
 * WebviewPlotInstance component. This component renders a webview as a plot in
 * the Plots pane.
 *
 * @param props A WebviewPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const WebviewPlotInstance = (props: WebviewPlotInstanceProps) => {
	const webviewRef = React.useRef<HTMLDivElement>(null);
	const [clientIsClaimed, setClientIsClaimed] = React.useState(false);

	useEffect(() => {
		const client = props.plotClient;
		// Only claim if the plot is visible to avoid rendering the webview when
		// the parent view pane is collapsed.
		if (props.visible) {
			client.activate().then(() => {
				// Pass the element ref so the webview gets the correct window context
				// (important for auxiliary windows)
				client.claim(this, webviewRef.current || undefined);
				setClientIsClaimed(true);
			});
		}
		return () => {
			client.release(this);
			setClientIsClaimed(false);
		};
	}, [props.plotClient, props.visible]);

	useEffect(() => {
		// If the client is not claimed, do nothing.
		// This is to avoid activating the client when it isn't claimed, which could happen
		// if the previous effect is cleaned up before this one runs.
		if (!clientIsClaimed || !webviewRef.current) {
			return;
		}

		const client = props.plotClient;
		const element = webviewRef.current;

		// Use ResizeObserver to detect when the element gets dimensions.
		// This is especially important in auxiliary windows where the element
		// might not have its final dimensions immediately after mounting.
		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// Only layout if the element has non-zero dimensions
				if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
					client.layoutWebviewOverElement(element);
				}
			}
		});

		resizeObserver.observe(element);

		return () => {
			resizeObserver.disconnect();
		};
	}, [clientIsClaimed, props.plotClient]);

	const style = {
		width: `${props.width}px`,
		height: `${props.height}px`,
	};

	// The DOM we render is just a single div that the webview will be
	// positioned over.
	return (
		<div ref={webviewRef} className='plot-instance' style={style}>
		</div>
	);
};
