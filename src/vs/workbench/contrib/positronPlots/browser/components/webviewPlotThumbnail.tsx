/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { WebviewPlotClient } from '../webviewPlotClient.js';
import { PlaceholderThumbnail } from './placeholderThumbnail.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';

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
	const context = usePositronPlotsContext();
	const [uri, setUri] = useState(() => {
		// If the plot is already rendered, set the URI; otherwise, try to use the cached URI until
		// the plot is rendered.
		if (props.plotClient.thumbnailUri) {
			return props.plotClient.thumbnailUri;
		} else {
			return context.positronPlotsService.getCachedPlotThumbnailURI(props.plotClient.id);
		}
	});

	useEffect(() => {
		// When the plot is rendered, update the URI. This can happen multiple times if the plot
		// is resized.
		const disposable = props.plotClient.onDidRenderThumbnail((result) => {
			setUri(result);
		});

		return () => disposable.dispose();
	}, [context.positronPlotsService, props.plotClient]);

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered thumbnail.
	if (uri) {
		return <img alt={'Plot ' + props.plotClient.id} src={uri} />;
	} else {
		return <PlaceholderThumbnail />;
	}
};
