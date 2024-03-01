/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';

export enum ZoomLevel {
	Fill = 0,
	Fifty = 0.5,
	SeventyFive = 0.75,
	OneHundred = 1,
	TwoHundred = 2,
}

interface ZoomPlotMenuButtonProps {
	readonly actionHandler: (zoomLevel: ZoomLevel) => void;
	readonly zoomLevel: number;
}

const zoomLevelMap = new Map<ZoomLevel, string>([
	[ZoomLevel.Fill, nls.localize('positronZoomFill', 'Fill')],
	[ZoomLevel.Fifty, nls.localize('positronZoomFifty', '50%')],
	[ZoomLevel.SeventyFive, nls.localize('positronZoomSeventyFive', '75%')],
	[ZoomLevel.OneHundred, nls.localize('positronZoomActual', '100%')],
	[ZoomLevel.TwoHundred, nls.localize('positronZoomDouble', '200%')],
]);
const zoomPlotTooltip = nls.localize('positronZoomPlotTooltip', "Set the plot zoom");

/**
 * SizingPolicyMenuButton component.
 * @param props A SizingPolicyMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ZoomPlotMenuButton = (props: ZoomPlotMenuButtonProps) => {
	const zoomLevels = [ZoomLevel.Fill, ZoomLevel.Fifty, ZoomLevel.SeventyFive, ZoomLevel.OneHundred, ZoomLevel.TwoHundred];
	// State.
	const [activeZoomLabel, setActiveZoomLabel] =
		React.useState(zoomLevelMap.get(props.zoomLevel) || ZoomLevel[props.zoomLevel]);

	// Builds the actions.
	const actions = () => {
		const actions: IAction[] = [];

		zoomLevels.forEach((zoomLevel) => {
			const zoomLabel = zoomLevelMap.get(zoomLevel) || ZoomLevel[zoomLevel];

			actions.push({
				id: ZoomLevel[zoomLevel],
				label: zoomLabel,
				tooltip: '',

				class: undefined,
				enabled: true,
				run: () => {
					setActiveZoomLabel(zoomLabel);
					props.actionHandler(zoomLevel);
				}
			});
		});

		return actions;
	};

	return (
		<ActionBarMenuButton
			iconId='symbol-ruler'
			text={activeZoomLabel}
			tooltip={zoomPlotTooltip}
			actions={actions}
		/>
	);
};
