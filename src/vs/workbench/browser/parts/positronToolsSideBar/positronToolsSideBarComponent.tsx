/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/toolsSideBarComponent';
const React = require('react');
import { useEffect, useState } from 'react';
import { HelpComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/helpComponent/helpComponent';
import { PlotComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/plotComponent/plotComponent';
import { ViewerComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/viewerComponent/viewerComponent';
import { PreviewComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/previewComponent/previewComponent';
import { EnvironmentComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/environmentComponent/environmentComponent';
import { PresentationComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/presentationComponent/presentationComponent';
import { PositronToolsBarBottomMode, PositronToolsBarTopMode, IPositronToolsBarService } from 'vs/workbench/services/positronToolsBar/browser/positronToolsBarService';

/**
 * PositronToolsSideBarComponentProps interface.
 */
interface PositronToolsSideBarComponentProps {
	placeholder: string;
	positronToolsBarService: IPositronToolsBarService;
}

/**
 * PositronToolsSideBarComponent component.
 * @param props A PositronToolsSideBarComponentProps that contains the component properties.
 * @returns The component.
 */
export const PositronToolsSideBarComponent = (props: PositronToolsSideBarComponentProps) => {
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
	const topComponent = () => {
		switch (topMode) {
			case PositronToolsBarTopMode.Empty:
				return null;
			case PositronToolsBarTopMode.Environment:
				return <EnvironmentComponent placeholder='Environment' />;
			case PositronToolsBarTopMode.Preview:
				return <PreviewComponent placeholder='Preview' />;
			case PositronToolsBarTopMode.Help:
				return <HelpComponent placeholder='Help' />;
		}
	};

	// Renders the bottom component.
	const bottomComponent = () => {
		switch (bottomMode) {
			case PositronToolsBarBottomMode.Empty:
				return null;
			case PositronToolsBarBottomMode.Plot:
				return <PlotComponent placeholder='Plot' />;
			case PositronToolsBarBottomMode.Viewer:
				return <ViewerComponent placeholder='Viewer' />;
			case PositronToolsBarBottomMode.Presentation:
				return <PresentationComponent placeholder='Presentation' />;
		}
	};

	// Render.
	return (
		<div>
			<div>PositronToolsSideBar {props.placeholder}</div>
			{topComponent()}
			{bottomComponent()}
		</div>
	);
};
