/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const LOGO = '.product-logo';
const TITLE = '.gettingStartedCategoriesContainer div.header div .positron';
const FOOTER = '.gettingStartedCategoriesContainer div.footer';
const START_SECTION = '.positron-welcome-page-open';
const HELP_TITLE = '.positron-welcome-page-help';
const OPEN_SECTION = '.categories-column.categories-column-right .index-list.start-container';
const RECENT_SECTION = '.categories-column.categories-column-right .index-list.recently-opened';

const HEADING_ROLE = 'heading';
const BUTTON_ROLE = 'button';
const LINK_ROLE = 'link';

export class PositronWelcome {

	logo = this.code.driver.getLocator(LOGO);
	title = this.code.driver.getLocator(TITLE);
	footer = this.code.driver.getLocator(FOOTER);
	startSection = this.code.driver.getLocator(START_SECTION);
	startTitle = this.startSection.getByRole(HEADING_ROLE);
	startButtons = this.startSection.getByRole(BUTTON_ROLE);
	helpSection = this.code.driver.getLocator(HELP_TITLE);
	helpTitle = this.helpSection.getByRole(HEADING_ROLE);
	helpLinks = this.helpSection.getByRole(LINK_ROLE);
	openSection = this.code.driver.getLocator(OPEN_SECTION);
	openTitle = this.openSection.getByRole(HEADING_ROLE);
	openButtons = this.openSection.getByRole(BUTTON_ROLE);
	recentSection = this.code.driver.getLocator(RECENT_SECTION);
	recentTitle = this.recentSection.getByRole(HEADING_ROLE);
	newNotebookButton = this.startButtons.getByText('New Notebook');
	newFileButton = this.startButtons.getByText('New File');
	newConsoleButton = this.startButtons.getByText('New Console');
	newProjectButton = this.startButtons.getByText('New Project');

	constructor(private code: Code) { }
}
