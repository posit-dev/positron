/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
// import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';

/**
 * Positron modal dialogs command ID's.
 */
const enum PositronModalDialogsCommandId {
	ShowExampleDialog = 'workbench.action.positronModalDialogs.showExampleDialog',
}

/**
 * Positron modal dialogs action category.
 */
const POSITRON_MODAL_DIALOGS_ACTION_CATEGORY = localize('positronModalDialogsCategory', "ModalDialogs");

/**
 * Registers Positron modal dialogs actions.
 */
export function registerPositronModalDialogsActions() {
	/**
	 * The category for the actions below.
	 */
	const category: ILocalizedString = {
		value: POSITRON_MODAL_DIALOGS_ACTION_CATEGORY,
		original: 'ModalDialogs'
	};

	/**
	 * Register the show example modal dialog action.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronModalDialogsCommandId.ShowExampleDialog,
				title: {
					value: localize('workbench.action.positronModalDialogs.showExampleModalDialog', "Show Example Modal Dialog"),
					original: 'Show Example Dialog'
				},
				f1: true,
				category,
				precondition: IsDevelopmentContext
			});
		}

		/**
		 * Runs action.
		 * @param accessor The services accessor.
		 */
		async run(accessor: ServicesAccessor) {
			// const positronModalDialogsService = accessor.get(IPositronModalDialogsService);
			// positronModalDialogsService.showExampleModalDialog1('Example');
		}
	});
}
