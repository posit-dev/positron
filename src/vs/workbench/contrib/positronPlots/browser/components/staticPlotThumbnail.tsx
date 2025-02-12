/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';

/**
 * StaticPlotThumbnailProps interface.
 */
interface StaticPlotThumbnailProps {
	plotClient: StaticPlotClient;
}

/**
 * StaticPlotThumbnail component. This component renders a thumbnail of a plot instance.
 *
 * @param props A StaticPlotThumbnailProps that contains the component properties.
 * @returns The rendered component.
 */
export const StaticPlotThumbnail = (props: StaticPlotThumbnailProps) => {
	return <img alt={'Plot ' + props.plotClient.id} className='plot' src={props.plotClient.uri} />;
};
