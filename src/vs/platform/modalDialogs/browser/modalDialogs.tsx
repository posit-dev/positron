/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogs';
const React = require('react');
import * as _ from 'react';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import { ModalDisplayDialogComponent, ModalDisplayDialogComponentProps } from 'vs/base/browser/ui/modalComponents/modalDisplayDialogComponent';
import { ModalDialogComponent, ModalDialogComponentProps } from 'vs/base/browser/ui/modalComponents/modalDialogComponent';
import { ReactRenderer } from 'vs/base/browser/ui/modalComponents/reactRenderer';
import { TestComponent } from 'vs/base/browser/ui/testComponent/testComponent';
import { SimpleTitleBarComponent } from 'vs/base/browser/ui/modalComponents/components/titleBarComponent';
import { OKActionBarComponent } from 'vs/base/browser/ui/modalComponents/components/okActionBarComponent';
import { OKCancelActionBarComponent } from 'vs/base/browser/ui/modalComponents/components/okCancelActionBarComponent';
import { ContentAreaComponent } from 'vs/base/browser/ui/modalComponents/components/contentAreaComponent';

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
	 * Shows the example modal dialog.
	 * @returns A Promise<void> that resolves when the example modal dialog is done.
	 */
	async showExampleModalDialog(title: string): Promise<void> {
		return new Promise<void>((resolve) => {
			// Create the react renderer.
			const reactRenderer = new ReactRenderer(this.layoutService.container);

			const props: ModalDisplayDialogComponentProps = {
				enableEnter: true,
				enableEscape: true,
				done: () => {
					reactRenderer.destroy();
					resolve();
				},
			};

			const ExampleModalDialogComponent = (props: ModalDisplayDialogComponentProps) => {
				return (
					<ModalDisplayDialogComponent enableEscape={true} enableEnter={true} done={props.done}>
						<SimpleTitleBarComponent title={title} />
						<ContentAreaComponent>
							<TestComponent message='Example' />
						</ContentAreaComponent>
						<OKActionBarComponent ok={props.done} />
					</ModalDisplayDialogComponent>
				);
			};

			reactRenderer.render(<ExampleModalDialogComponent {...props} />);
		});
	}

	/**
	 * Shows the example modal dialog.
	 */
	async showExampleConfirmationModalDialog(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const reactRenderer = new ReactRenderer(this.layoutService.container);

			const props: ModalDialogComponentProps<boolean> = {
				enableEnter: true,
				enableEscape: true,
				accept: (result: boolean) => {
					reactRenderer.destroy();
					resolve(result);
				},
			};

			const ExampleConfirmationModalDialogComponent = (props: ModalDialogComponentProps<boolean>) => {
				// Render.
				return (
					<ModalDialogComponent {...props} escape={() => props.accept(false)} enter={() => props.accept(true)}>
						<SimpleTitleBarComponent title='Example Modal Dialog' />
						<div className='content-area'>
							<TestComponent message='Example' />
						</div>
						<OKCancelActionBarComponent cancel={() => props.accept(false)} ok={() => props.accept(true)} />
					</ModalDialogComponent>
				);
			};

			reactRenderer.render(<ExampleConfirmationModalDialogComponent {...props} />);
		});
	}
}
