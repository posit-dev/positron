/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialogs';
import * as _ from 'react';
const React = require('react');
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/browser/positronModalDialogs';
import { TestContent } from 'vs/workbench/browser/parts/positronModalDialog/components/testContent';
import { OKActionBar } from 'vs/workbench/browser/parts/positronModalDialog/components/okActionBar';
import { ContentArea } from 'vs/workbench/browser/parts/positronModalDialog/components/contentArea';
import { PositronModalDialog } from 'vs/workbench/browser/parts/positronModalDialog/positronModalDialog';
import { SimpleTitleBar } from 'vs/workbench/browser/parts/positronModalDialog/components/simpleTitleBar';
import { OKCancelActionBar } from 'vs/workbench/browser/parts/positronModalDialog/components/okCancelActionBar';
import { PositronModalDialogReactRenderer } from 'vs/workbench/browser/parts/positronModalDialog/positronModalDialogReactRenderer';

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

			// The modal dialog component.
			const ModalDialog = () => {
				return (
					<PositronModalDialog width={400} height={300} enter={acceptHandler} escape={acceptHandler}>
						<SimpleTitleBar title={title} />
						<ContentArea>
							<TestContent message='Example' />
						</ContentArea>
						<OKActionBar ok={acceptHandler} />
					</PositronModalDialog>
				);
			};

			// Render the modal dialog component.
			positronModalDialogReactRenderer.render(<ModalDialog />);
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

			// The modal dialog component.
			const ModalDialog = () => {
				// Render.
				return (
					<PositronModalDialog width={400} height={300} enter={() => acceptHandler(true)} escape={() => acceptHandler(false)}>
						<SimpleTitleBar title={title} />
						<ContentArea>
							<TestContent message='Example' />
						</ContentArea>
						<OKCancelActionBar ok={() => acceptHandler(true)} cancel={() => acceptHandler(false)} />
					</PositronModalDialog>
				);
			};

			// Render the modal dialog component.
			positronModalDialogReactRenderer.render(<ModalDialog />);
		});
	}
}
