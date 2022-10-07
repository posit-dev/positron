/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogs';
const React = require('react');
import * as _ from 'react';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import { ModalDialogComponent } from 'vs/base/browser/ui/modalDialogComponent/modalDialogComponent';
import { ModalDialogReactRenderer } from 'vs/base/browser/ui/modalDialogComponent/modalDialogReactRenderer';
import { TestComponent } from 'vs/base/browser/ui/testComponent/testComponent';
import { SimpleTitleBarComponent } from 'vs/base/browser/ui/modalDialogComponent/components/simpleTitleBarComponent';
import { OKActionBarComponent } from 'vs/base/browser/ui/modalDialogComponent/components/okActionBarComponent';
import { OKCancelActionBarComponent } from 'vs/base/browser/ui/modalDialogComponent/components/okCancelActionBarComponent';
import { ContentAreaComponent } from 'vs/base/browser/ui/modalDialogComponent/components/contentAreaComponent';

/**
 * ModalDialogs class.
 */
export class ModalDialogs implements IModalDialogsService {

	declare readonly _serviceBrand: undefined;

	/**
	 * Initializes a new instance of the ModalDialogs class.
	 * @param layoutService The layout service.
	 */
	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
	) {
	}

	/**
	 * Shows example modal dialog 1.
	 * @returns A Promise<void> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog1(title: string): Promise<void> {
		// Return a promise that resolves when the example modal dialog is done.
		return new Promise<void>((resolve) => {
			// Create the modal dialog React renderer.
			const modalDialogReactRenderer = new ModalDialogReactRenderer(this.layoutService.container);

			// The accept handler.
			const acceptHandler = () => {
				modalDialogReactRenderer.destroy();
				resolve();
			};

			// The example modal dialog component.
			const ExampleModalDialogComponent = () => {
				return (
					<ModalDialogComponent width={400} height={300} enter={acceptHandler} escape={acceptHandler}>
						<SimpleTitleBarComponent title={title} />
						<ContentAreaComponent>
							<TestComponent message='Example' />
						</ContentAreaComponent>
						<OKActionBarComponent ok={acceptHandler} />
					</ModalDialogComponent>
				);
			};

			// Render the example modal dialog component.
			modalDialogReactRenderer.render(<ExampleModalDialogComponent />);
		});
	}

	/**
	 * Shows example modal dialog 2.
	 * @returns A Promise<boolean> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog2(title: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			// Create the modal dialog React renderer.
			const modalDialogReactRenderer = new ModalDialogReactRenderer(this.layoutService.container);

			// The accept handler.
			const acceptHandler = (result: boolean) => {
				modalDialogReactRenderer.destroy();
				resolve(result);
			};

			// The example modal dialog component.
			const ExampleModalDialogComponent = () => {
				// Render.
				return (
					<ModalDialogComponent width={400} height={300} enter={() => acceptHandler(true)} escape={() => acceptHandler(false)}>
						<SimpleTitleBarComponent title={title} />
						<ContentAreaComponent>
							<TestComponent message='Example' />
						</ContentAreaComponent>
						<OKCancelActionBarComponent ok={() => acceptHandler(true)} cancel={() => acceptHandler(false)} />
					</ModalDialogComponent>
				);
			};

			// Render the example modal dialog component.
			modalDialogReactRenderer.render(<ExampleModalDialogComponent />);
		});
	}
}
