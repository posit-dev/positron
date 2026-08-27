/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';

export const POSITRON_HELP_CHEAT_SHEETS_SUBMENU = new MenuId('PositronHelpCheatSheetsSubmenu');
export const POSITRON_HELP_R_CHEAT_SHEETS_SUBMENU = new MenuId('PositronHelpRCheatSheetsSubmenu');

interface IPositronCheatSheet {
	/** Command id; each sheet needs its own because a menu item cannot carry arguments. */
	readonly id: string;
	/** Menu label, and the Command Palette entry under the Help category. */
	readonly title: ILocalizedString;
	/** The sheet itself, opened in the external browser. */
	readonly url: string;
}

const R_CHEAT_SHEETS: readonly IPositronCheatSheet[] = [
	{
		id: 'positron.help.cheatSheets.r.dplyr',
		title: localize2('positron.help.cheatSheets.r.dplyr', 'Data Transformation with dplyr'),
		url: 'https://raw.githubusercontent.com/rstudio/cheatsheets/main/data-transformation.pdf'
	},
	{
		id: 'positron.help.cheatSheets.r.ggplot2',
		title: localize2('positron.help.cheatSheets.r.ggplot2', 'Data Visualization with ggplot2'),
		url: 'https://raw.githubusercontent.com/rstudio/cheatsheets/main/data-visualization.pdf'
	},
	{
		id: 'positron.help.cheatSheets.r.purrr',
		title: localize2('positron.help.cheatSheets.r.purrr', 'List Manipulation with purrr'),
		url: 'https://raw.githubusercontent.com/rstudio/cheatsheets/main/purrr.pdf'
	},
	{
		id: 'positron.help.cheatSheets.r.shiny',
		title: localize2('positron.help.cheatSheets.r.shiny', 'Web Applications with shiny'),
		url: 'https://raw.githubusercontent.com/rstudio/cheatsheets/main/shiny.pdf'
	}
];

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	submenu: POSITRON_HELP_CHEAT_SHEETS_SUBMENU,
	title: localize('positron.help.cheatSheets', 'Cheat Sheets'),
	group: '2_reference',
	order: 1
});

MenuRegistry.appendMenuItem(POSITRON_HELP_CHEAT_SHEETS_SUBMENU, {
	submenu: POSITRON_HELP_R_CHEAT_SHEETS_SUBMENU,
	title: localize('positron.help.cheatSheets.r', 'R'),
	group: '1_languages',
	order: 1
});

for (const [index, cheatSheet] of R_CHEAT_SHEETS.entries()) {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: cheatSheet.id,
				title: cheatSheet.title,
				category: Categories.Help,
				f1: true,
				menu: {
					id: POSITRON_HELP_R_CHEAT_SHEETS_SUBMENU,
					group: '1_sheets',
					order: index + 1
				}
			});
		}

		override async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(IOpenerService).open(URI.parse(cheatSheet.url));
		}
	});
}
