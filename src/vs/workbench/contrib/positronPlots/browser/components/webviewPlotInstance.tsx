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
				client.claim(this);
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
		if (!clientIsClaimed) {
			return;
		}

		const client = props.plotClient;
		client.activate().then(() => {
			if (webviewRef.current) {
				client.layoutWebviewOverElement(webviewRef.current);
			}
		});
	});

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
