/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

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
	return <img src={props.plotClient.uri} alt={'Plot ' + props.plotClient.id} />;
};
