/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronToolsSideBar';
const React = require('react');
import { useEffect, useState } from 'react';
import { HelpTool } from 'vs/workbench/browser/parts/positronToolsSideBar/components/helpTool/helpTool';
import { PlotTool } from 'vs/workbench/browser/parts/positronToolsSideBar/components/plotTool/plotTool';
import { ViewerTool } from 'vs/workbench/browser/parts/positronToolsSideBar/components/viewerTool/viewerTool';
import { PreviewTool } from 'vs/workbench/browser/parts/positronToolsSideBar/components/previewTool/previewTool';
import { EnvironmentTool } from 'vs/workbench/browser/parts/positronToolsSideBar/components/environmentTool/environmentTool';
import { PresentationTool } from 'vs/workbench/browser/parts/positronToolsSideBar/components/presentationTool/presentationTool';
import { PositronToolsBarBottomMode, PositronToolsBarTopMode, IPositronToolsBarService } from 'vs/workbench/services/positronToolsBar/browser/positronToolsBarService';

/**
 * PositronToolsSideBarProps interface.
 */
interface PositronToolsSideBarProps {
	placeholder: string;
	positronToolsBarService: IPositronToolsBarService;
}

/**
 * PositronToolsSideBar component.
 * @param props A PositronToolsSideBarProps that contains the component properties.
 * @returns The component.
 */
export const PositronToolsSideBar = (props: PositronToolsSideBarProps) => {
	// Hooks.
	const [topMode, setTopMode] = useState<PositronToolsBarTopMode>(PositronToolsBarTopMode.Empty);
	const [bottomMode, setBottomMode] = useState<PositronToolsBarBottomMode>(PositronToolsBarBottomMode.Empty);
	useEffect(() => {
		props.positronToolsBarService.onDidChangeTopMode(toolsBarTopMode => {
			setTopMode(toolsBarTopMode);
		});

		props.positronToolsBarService.onDidChangeBottomMode(toolsBarBottomMode => {
			setBottomMode(toolsBarBottomMode);
		});
	}, []);

	// Renders the top component.
	const renderTop = () => {
		switch (topMode) {
			case PositronToolsBarTopMode.Empty:
				return null;
			case PositronToolsBarTopMode.Environment:
				return <EnvironmentTool placeholder='Environment' />;
			case PositronToolsBarTopMode.Preview:
				return <PreviewTool placeholder='Preview' />;
			case PositronToolsBarTopMode.Help:
				return <HelpTool placeholder='Help' />;
		}
	};

	// Renders the bottom component.
	const renderBottom = () => {
		switch (bottomMode) {
			case PositronToolsBarBottomMode.Empty:
				return null;
			case PositronToolsBarBottomMode.Plot:
				return <PlotTool placeholder='Plot' />;
			case PositronToolsBarBottomMode.Viewer:
				return <ViewerTool placeholder='Viewer' />;
			case PositronToolsBarBottomMode.Presentation:
				return <PresentationTool placeholder='Presentation' />;
		}
	};

	// Render.
	return (
		<div>
			<div>PositronToolsSideBar {props.placeholder}</div>
			{renderTop()}
			{renderBottom()}
		</div>
	);
};
