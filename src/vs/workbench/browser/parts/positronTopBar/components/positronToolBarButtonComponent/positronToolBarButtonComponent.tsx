/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/positronToolBarButtonComponent';
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
 * PositronToolBarButtomComponentProps interface.
 */
interface PositronToolBarButtomComponentProps {
	placeholder: string;
}

/**
 * PositronToolBarButtomComponent component.
 * @param props A PositronToolBarButtomComponentProps that contains the component properties.
 * @returns The component.
 */
export const PositronToolBarButtomComponent = (props: PositronToolBarButtomComponentProps) => {
	// Render.
	return (
		<div className='positron-x'>
			Button
		</div>
	);
};
