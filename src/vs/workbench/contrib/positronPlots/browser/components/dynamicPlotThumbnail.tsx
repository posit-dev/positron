/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { PlaceholderThumbnail } from './placeholderThumbnail.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';

/**
 * DynamicPlotThumbnailProps interface.
 */
interface DynamicPlotThumbnailProps {
	plotClient: PlotClientInstance;
}

/**
 * DynamicPlotThumbnail component. This component renders a thumbnail of a plot instance.
 *
 * @param props A DynamicPlotThumbnailProps that contains the component properties.
 * @returns The rendered component.
 */
export const DynamicPlotThumbnail = (props: DynamicPlotThumbnailProps) => {

	const [uri, setUri] = useState('');

	useEffect(() => {
		// If the plot is already rendered, show the URI; otherwise, wait for
		// the plot to render.
		if (props.plotClient.lastRender) {
			setUri(props.plotClient.lastRender.uri);
		}

		// When the plot is rendered, update the URI. This can happen multiple times if the plot
		// is resized.
		props.plotClient.onDidCompleteRender((result) => {
			setUri(result.uri);
		});
	}, [props.plotClient]);

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered plot.
	//
	// Consider: we probably want a more explicit loading state; as written we
	// will show the old URI until the new one is ready.
	if (uri) {
		return <img alt={'Plot ' + props.plotClient.id} className='plot' src={uri} />;
	} else {
		return <PlaceholderThumbnail />;
	}
};
