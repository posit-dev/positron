/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialogs';
import * as _ from 'react';
const React = require('react');
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/browser/positronModalDialogs';
import { PositronTestComponent } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/components/positronTestComponent';
import { PositronModalDialogComponent } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/positronModalDialogComponent';
import { PositronModalDialogReactRenderer } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/positronModalDialogReactRenderer';
import { PositronOKActionBarComponent } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/components/positronOKActionBarComponent';
import { PositronContentAreaComponent } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/components/positronContentAreaComponent';
import { PositronSimpleTitleBarComponent } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/components/positronSimpleTitleBarComponent';
import { PositronOKCancelActionBarComponent } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/components/positronOKCancelActionBarComponent';

/**
 * PositronModalDialogs class.
 */
export class PositronModalDialogs implements IPositronModalDialogsService {

	declare readonly _serviceBrand: undefined;

	/**
	 * Initializes a new instance of the PositronModalDialogs class.
	 * @param layoutService The layout service.
	 */
	constructor(@ILayoutService private readonly layoutService: ILayoutService) { }

	/**
	 * Shows example modal dialog 1.
	 * @returns A Promise<void> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog1(title: string): Promise<void> {
		// Return a promise that resolves when the example modal dialog is done.
		return new Promise<void>((resolve) => {
			// Create the modal dialog React renderer.
			const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(this.layoutService.container);

			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve();
			};

			// The example modal dialog component.
			const PositronExampleModalDialogComponent = () => {
				return (
					<PositronModalDialogComponent width={400} height={300} enter={acceptHandler} escape={acceptHandler}>
						<PositronSimpleTitleBarComponent title={title} />
						<PositronContentAreaComponent>
							<PositronTestComponent message='Example' />
						</PositronContentAreaComponent>
						<PositronOKActionBarComponent ok={acceptHandler} />
					</PositronModalDialogComponent>
				);
			};

			// Render the example modal dialog component.
			positronModalDialogReactRenderer.render(<PositronExampleModalDialogComponent />);
		});
	}

	/**
	 * Shows example modal dialog 2.
	 * @returns A Promise<boolean> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog2(title: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			// Create the modal dialog React renderer.
			const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(this.layoutService.container);

			// The accept handler.
			const acceptHandler = (result: boolean) => {
				positronModalDialogReactRenderer.destroy();
				resolve(result);
			};

			// The example modal dialog component.
			const PositronExampleModalDialogComponent = () => {
				// Render.
				return (
					<PositronModalDialogComponent width={400} height={300} enter={() => acceptHandler(true)} escape={() => acceptHandler(false)}>
						<PositronSimpleTitleBarComponent title={title} />
						<PositronContentAreaComponent>
							<PositronTestComponent message='Example' />
						</PositronContentAreaComponent>
						<PositronOKCancelActionBarComponent ok={() => acceptHandler(true)} cancel={() => acceptHandler(false)} />
					</PositronModalDialogComponent>
				);
			};

			// Render the example modal dialog component.
			positronModalDialogReactRenderer.render(<PositronExampleModalDialogComponent />);
		});
	}
}
