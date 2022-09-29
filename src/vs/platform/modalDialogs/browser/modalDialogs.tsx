/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogs';
const React = require('react');
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import { ModalDialogComponent, ModalDialogComponentProps } from 'vs/base/browser/ui/modalDialog/modalDialogComponent';
import { ModalDialogPresenter } from 'vs/base/browser/ui/modalDialog/modalDialogPresenter';
import { TestComponent } from 'vs/base/browser/ui/testComponent/testComponent';
import { SimpleTitleBarComponent } from 'vs/base/browser/ui/modalDialog/parts/titleBarComponent';
import { ActionsBarComponent } from 'vs/base/browser/ui/modalDialog/parts/actionsBarComponent';

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
	 * Shows the time modal dialog.
	 * @returns A Promise<void> that will resolve when the time modal dialog is dismissed.
	 */
	async showTimeModalDialog(): Promise<void> {

		return new Promise<void>((resolve) => {
			const modalDialogPresenter = new ModalDialogPresenter(this.layoutService.container);
			const destroy = () => {
				modalDialogPresenter.destroy();
				resolve();
			};
			const modalDialogComponentProps: ModalDialogComponentProps<void> = {
				enterAccepts: true,
				escapeCancels: true,
				result: destroy,
				cancel: destroy
			};
			modalDialogPresenter.present(<TimeModalDialogComponent {...modalDialogComponentProps} />);
		});
	}
}

const TimeModalDialogComponent = (props: ModalDialogComponentProps<void>) => {
	// Handlers.
	const escapeHandler = () => {
		props.result();
	};
	const acceptHandler = () => {
		props.result();
	};

	// Render.
	return (
		<ModalDialogComponent {...props} escape={escapeHandler} accept={acceptHandler}>
			<SimpleTitleBarComponent title='Show Time' />
			<div className='content-area'>
				<TestComponent message='TEST' />
			</div>
			<ActionsBarComponent done={acceptHandler} />
		</ModalDialogComponent>
	);
};
