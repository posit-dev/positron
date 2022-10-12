/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/toolsSideBarComponent';
const React = require('react');
import { useEffect, useState } from 'react';
import { HelpComponent } from 'vs/workbench/browser/parts/toolsSideBar/components/helpComponent/helpComponent';
import { PlotComponent } from 'vs/workbench/browser/parts/toolsSideBar/components/plotComponent/plotComponent';
import { ViewerComponent } from 'vs/workbench/browser/parts/toolsSideBar/components/viewerComponent/viewerComponent';
import { PreviewComponent } from 'vs/workbench/browser/parts/toolsSideBar/components/previewComponent/previewComponent';
import { EnvironmentComponent } from 'vs/workbench/browser/parts/toolsSideBar/components/environmentComponent/environmentComponent';
import { PresentationComponent } from 'vs/workbench/browser/parts/toolsSideBar/components/presentationComponent/presentationComponent';
import { ToolsBarBottomMode, ToolsBarTopMode, IToolsBarService } from 'vs/workbench/services/toolsBar/browser/toolsBarService';

/**
 * ToolsSideBarComponentProps interface.
 */
interface ToolsSideBarComponentProps {
	placeholder: string;
	toolsBarService: IToolsBarService;
}

/**
 * ToolsSideBarComponent component.
 * @param props A ToolsSideBarComponentProps that contains the component properties.
 * @returns The component.
 */
export const ToolsSideBarComponent = (props: ToolsSideBarComponentProps) => {
	// Hooks.
	const [topMode, setTopMode] = useState<ToolsBarTopMode>(ToolsBarTopMode.Empty);
	const [bottomMode, setBottomMode] = useState<ToolsBarBottomMode>(ToolsBarBottomMode.Empty);
	useEffect(() => {
		props.toolsBarService.onDidChangeTopMode(toolsBarTopMode => {
			setTopMode(toolsBarTopMode);
		});

		props.toolsBarService.onDidChangeBottomMode(toolsBarBottomMode => {
			setBottomMode(toolsBarBottomMode);
		});
	}, []);

	// Renders the top component.
	const topComponent = () => {
		switch (topMode) {
			case ToolsBarTopMode.Empty:
				return null;
			case ToolsBarTopMode.Environment:
				return <EnvironmentComponent placeholder='Environment' />;
			case ToolsBarTopMode.Preview:
				return <PreviewComponent placeholder='Preview' />;
			case ToolsBarTopMode.Help:
				return <HelpComponent placeholder='Help' />;
		}
	};

	// Renders the bottom component.
	const bottomComponent = () => {
		switch (bottomMode) {
			case ToolsBarBottomMode.Empty:
				return null;
			case ToolsBarBottomMode.Plot:
				return <PlotComponent placeholder='Plot' />;
			case ToolsBarBottomMode.Viewer:
				return <ViewerComponent placeholder='Viewer' />;
			case ToolsBarBottomMode.Presentation:
				return <PresentationComponent placeholder='Presentation' />;
		}
	};

	console.log('Rendering tools side bar component');

	// Render.
	return (
		<div>
			<div>ToolsSideBar {props.placeholder}</div>
			{topComponent()}
			{bottomComponent()}
		</div>
	);
};
