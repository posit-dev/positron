/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogs';
const React = require('react');
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import ModalDialogComponent from 'vs/base/browser/ui/modalDialog/modalDialogComponent';
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
			modalDialogPresenter.present(<TimeModalDialogComponent done={() => {
				modalDialogPresenter.destroy();
				resolve();
			}} />);
		});
	}
}

interface TimeModalDialogComponentProps {
	done: () => void;
}

const TimeModalDialogComponent = (props: TimeModalDialogComponentProps) => {
	// Render.
	return (
		<ModalDialogComponent {...props}>
			<SimpleTitleBarComponent title='Show Time' />
			<div className='content-area'>
				<TestComponent message='TEST' />
			</div>
			<ActionsBarComponent {...props} />
		</ModalDialogComponent>
	);
};
