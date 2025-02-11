/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { PlaceholderThumbnail } from './placeholderThumbnail.js';
import { WebviewPlotClient } from '../webviewPlotClient.js';

/**
 * WebviewPlotThumbnailProps interface.
 */
interface WebviewPlotThumbnailProps {
	plotClient: WebviewPlotClient;
}

/**
 * WebviewPlotThumbnail component. This component renders a thumbnail of a plot
 * instance backed by a webview.
 *
 * @param props A WebviewPlotThumbnailProps that contains the component properties.
 * @returns The rendered component.
 */
export const WebviewPlotThumbnail = (props: WebviewPlotThumbnailProps) => {

	const [uri, setUri] = useState('');

	useEffect(() => {
		// If the plot is already rendered, show the URI; otherwise, wait for
		// the plot to render.
		if (props.plotClient.thumbnailUri) {
			setUri(props.plotClient.thumbnailUri);
		}

		// When the plot is rendered, update the URI. This can happen multiple times if the plot
		// is resized.
		const disposable = props.plotClient.onDidRenderThumbnail((result) => {
			setUri(result);
		});
		return () => {
			disposable.dispose();
		};
	}, [props.plotClient]);

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered thumbnail.
	if (uri) {
		return <img alt={'Plot ' + props.plotClient.id} src={uri} />;
	} else {
		return <PlaceholderThumbnail />;
	}
};
