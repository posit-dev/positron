/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { PlaceholderThumbnail } from 'vs/workbench/contrib/positronPlots/browser/components/placeholderThumbnail';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';

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
		props.plotClient.onDidRenderThumbnail((result) => {
			setUri(result);
		});
	});

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered thumbnail.
	if (uri) {
		return <img src={uri} alt={'Plot ' + props.plotClient.id} />;
	} else {
		return <PlaceholderThumbnail />;
	}
};
