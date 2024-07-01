/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
// import { QuickAccess } from '../quickaccess';
import { PositronTextElement } from './positronBaseElement';

const POSITRON_EXPLORER_PROJECT_TITLE = 'div[id="workbench.view.explorer"] h3.title';


/*
 *  Reuseable Positron explorer functionality for tests to leverage.
 */
export class PositronExplorer {
	explorerProjectTitle: PositronTextElement;


	constructor(private code: Code) {
		this.explorerProjectTitle = new PositronTextElement(POSITRON_EXPLORER_PROJECT_TITLE, this.code);

	}

}
