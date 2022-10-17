/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBarComponent';
import { PositronToolBarButtomComponent } from 'vs/workbench/browser/parts/positronTopBar/components/positronToolBarButtonComponent/positronToolBarButtonComponent';
const React = require('react');
// import { useEffect, useState } from 'react';
// import { HelpComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/helpComponent/helpComponent';
// import { PlotComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/plotComponent/plotComponent';
// import { ViewerComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/viewerComponent/viewerComponent';
// import { PreviewComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/previewComponent/previewComponent';
// import { EnvironmentComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/environmentComponent/environmentComponent';
// import { PresentationComponent } from 'vs/workbench/browser/parts/positronToolsSideBar/components/presentationComponent/presentationComponent';
// import { PositronToolsBarBottomMode, PositronToolsBarTopMode, IPositronToolsBarService } from 'vs/workbench/services/positronToolsBar/browser/positronToolsBarService';

/**
 * PositronTopBarComponentProps interface.
 */
interface PositronTopBarComponentProps {
	placeholder: string;
}

/**
 * PositronTopBarComponent component.
 * @param props A PositronTopBarComponentProps that contains the component properties.
 * @returns The component.
 */
export const PositronTopBarComponent = (props: PositronTopBarComponentProps) => {
	// Render.
	return (
		<div className='positron-top-bar'>
			<PositronToolBarButtomComponent placeholder='sss' />
			<PositronToolBarButtomComponent placeholder='sss' />
			<PositronToolBarButtomComponent placeholder='sss' />
			<PositronToolBarButtomComponent placeholder='sss' />
		</div>
	);
};
