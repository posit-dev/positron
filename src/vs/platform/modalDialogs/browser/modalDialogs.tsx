/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogs';
const React = require('react');
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import { ModalDisplayDialogComponent } from 'vs/base/browser/ui/modalComponents/modalDisplayDialogComponent';
import { ModalDialogComponent, ModalDialogComponentProps } from 'vs/base/browser/ui/modalComponents/modalDialogComponent';
import { ReactRenderer } from 'vs/base/browser/ui/modalComponents/reactRenderer';
import { TestComponent } from 'vs/base/browser/ui/testComponent/testComponent';
import { SimpleTitleBarComponent } from 'vs/base/browser/ui/modalComponents/components/titleBarComponent';
import { OKActionBarComponent } from 'vs/base/browser/ui/modalComponents/components/okActionBarComponent';
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
	async showExampleModalDialog(): Promise<void> {
		return new Promise<void>((resolve) => {
			const reactRenderer = new ReactRenderer(this.layoutService.container);
			const done = () => {
				reactRenderer.destroy();
				resolve();
			};
			reactRenderer.render(
				<ModalDisplayDialogComponent enableEscape={true} enableEnter={true} done={done}>
					<SimpleTitleBarComponent title='Example Modal Dialog' />
					<ContentAreaComponent>
						<TestComponent message='Example' />
					</ContentAreaComponent>
					<OKActionBarComponent done={done} />
				</ModalDisplayDialogComponent>
			);
		});
	}

	/**
	 * Shows the example modal dialog.
	 * @returns A Promise<void> that will resolve when the example modal dialog is dismissed.
	 */
	async showExampleModalDialog2(): Promise<void> {
		return new Promise<void>((resolve) => {
			const reactRenderer = new ReactRenderer(this.layoutService.container);
			const destroy = () => {
				reactRenderer.destroy();
				resolve();
			};
			const modalDialogComponentProps: ModalDialogComponentProps<void> = {
				enableEnter: true,
				enableEscape: true,
				result: destroy,
				cancel: destroy
			};

			const ExampleModalDialogComponent = (props: ModalDialogComponentProps<void>) => {
				// Handlers.
				const escapeHandler = () => {
					props.cancel();
				};
				const acceptHandler = () => {
					props.result();
				};

				// Render.
				return (
					<ModalDialogComponent {...props} escape={escapeHandler} enter={acceptHandler}>
						<SimpleTitleBarComponent title='Example Modal Dialog' />
						<div className='content-area'>
							<TestComponent message='Example' />
						</div>
						<OKActionBarComponent done={acceptHandler} />
					</ModalDialogComponent>
				);
			};

			reactRenderer.render(<ExampleModalDialogComponent {...modalDialogComponentProps} />);
		});
	}

	/**
	 * Shows the select time modal dialog.
	 * @returns A Promise<void> that will resolve when the time modal dialog is dismissed.
	 */
	async showSelectTimeModalDialog(): Promise<Date | void> {
		return new Promise<Date | void>((resolve) => {
			const modalDialogPresenter = new ReactRenderer(this.layoutService.container);
			const modalDialogComponentProps: ModalDialogComponentProps<Date> = {
				enableEnter: true,
				enableEscape: true,
				result: (date: Date) => {
					modalDialogPresenter.destroy();
					resolve(date);
				},
				cancel: () => {
					modalDialogPresenter.destroy();
					resolve();
				}
			};

			const SelectTimeModalDialogComponent = (props: ModalDialogComponentProps<Date>) => {

				// Handlers.
				const escapeHandler = () => {
					props.cancel();
				};
				const acceptHandler = () => {
					props.result(new Date());
				};

				// Render.
				return (
					<ModalDialogComponent {...props} escape={escapeHandler} enter={acceptHandler}>
						<SimpleTitleBarComponent title='Show Time' />
						<div className='content-area'>
							<TestComponent message='TEST' />
						</div>
						<OKActionBarComponent done={acceptHandler} />
					</ModalDialogComponent>
				);
			};

			modalDialogPresenter.render(<SelectTimeModalDialogComponent {...modalDialogComponentProps} />);
		});
	}
}
