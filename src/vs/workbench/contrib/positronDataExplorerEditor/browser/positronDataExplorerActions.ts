/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

/**
 * Positron data explorer action category.
 */
const POSITRON_DATA_EXPLORER_ACTION_CATEGORY = localize(
	'positronDataExplorerCategory',
	"Positron Data Explorer"
);

/**
 * The category for the actions below.
 */
const category: ILocalizedString = {
	value: POSITRON_DATA_EXPLORER_ACTION_CATEGORY,
	original: 'Positron Data Explorer'
};

/**
 * Positron data explorer command ID's.
 */
const enum PositronDataExplorerCommandId {
	PlaceholderAction = 'workbench.action.positronDataExplorer.placeholder',
}

/**
 * PositronDataExplorerPlaceholderAction action.
 */
class PositronDataExplorerPlaceholderAction extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.PlaceholderAction,
			title: {
				value: localize(
					'workbench.action.positronDataExplorer.placeholder',
					"Positron Data Explorer Placeholder"
				),
				original: 'Positron Data Explorer Placeholder'
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
		// Empty for now.
	}
}

/**
 * Registers Positron data explorer actions.
 */
export function registerPositronDataExplorerActions() {
	registerAction2(PositronDataExplorerPlaceholderAction);
}
