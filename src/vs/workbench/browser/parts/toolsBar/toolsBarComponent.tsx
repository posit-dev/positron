/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/toolsBarComponent';
const React = require('react');
import { useEffect, useState } from 'react';
import { HelpComponent } from 'vs/workbench/browser/parts/toolsBar/components/helpComponent/helpComponent';
import { PlotComponent } from 'vs/workbench/browser/parts/toolsBar/components/plotComponent/plotComponent';
import { ViewerComponent } from 'vs/workbench/browser/parts/toolsBar/components/viewerComponent/viewerComponent';
import { PreviewComponent } from 'vs/workbench/browser/parts/toolsBar/components/previewComponent/previewComponent';
import { EnvironmentComponent } from 'vs/workbench/browser/parts/toolsBar/components/environmentComponent/environmentComponent';
import { PresentationComponent } from 'vs/workbench/browser/parts/toolsBar/components/presentationComponent/presentationComponent';
import { AuxiliaryActivityBarBottomMode, AuxiliaryActivityBarTopMode, IAuxiliaryActivityBarService } from 'vs/workbench/services/auxiliaryActivityBar/browser/auxiliaryActivityBarService';

/**
 * ToolsBarComponentProps interface.
 */
interface ToolsBarComponentProps {
	placeholder: string;
	auxiliaryActivityBarService: IAuxiliaryActivityBarService;
}

/**
 * ToolsBarComponent component.
 * @param props A ToolsBarComponentProps that contains the component properties.
 * @returns The component.
 */
export const ToolsBarComponent = (props: ToolsBarComponentProps) => {
	// Hooks.
	const [topMode, setTopMode] = useState<AuxiliaryActivityBarTopMode>(AuxiliaryActivityBarTopMode.Empty);
	const [bottomMode, setBottomMode] = useState<AuxiliaryActivityBarBottomMode>(AuxiliaryActivityBarBottomMode.Empty);
	useEffect(() => {
		props.auxiliaryActivityBarService.onDidChangeTopMode(auxiliaryActivityBarTopMode => {
			setTopMode(auxiliaryActivityBarTopMode);
		});

		props.auxiliaryActivityBarService.onDidChangeBottomMode(auxiliaryActivityBarBottomMode => {
			setBottomMode(auxiliaryActivityBarBottomMode);
		});
	}, []);

	// Renders the top component.
	const topComponent = () => {
		switch (topMode) {
			case AuxiliaryActivityBarTopMode.Empty:
				return null;
			case AuxiliaryActivityBarTopMode.Environment:
				return <EnvironmentComponent placeholder='Environment' />;
			case AuxiliaryActivityBarTopMode.Preview:
				return <PreviewComponent placeholder='Preview' />;
			case AuxiliaryActivityBarTopMode.Help:
				return <HelpComponent placeholder='Help' />;
		}
	};

	// Renders the bottom component.
	const bottomComponent = () => {
		switch (bottomMode) {
			case AuxiliaryActivityBarBottomMode.Empty:
				return null;
			case AuxiliaryActivityBarBottomMode.Plot:
				return <PlotComponent placeholder='Plot' />;
			case AuxiliaryActivityBarBottomMode.Viewer:
				return <ViewerComponent placeholder='Viewer' />;
			case AuxiliaryActivityBarBottomMode.Presentation:
				return <PresentationComponent placeholder='Presentation' />;
		}
	};

	console.log('Rendering tools bar component');

	// Render.
	return (
		<div>
			<div>ToolsBar {props.placeholder}</div>
			{topComponent()}
			{bottomComponent()}
		</div>
	);
};
