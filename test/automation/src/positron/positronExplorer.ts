/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
// import { QuickAccess } from '../quickaccess';
import { PositronTextElement } from './positronBaseElement';

const POSITRON_EXPLORER_PROJECT_TITLE = 'div[id="workbench.view.explorer"] h3.title';


export class PositronExplorer {
	explorerProjectTitle: PositronTextElement;


	constructor(private code: Code) {
		this.explorerProjectTitle = new PositronTextElement(POSITRON_EXPLORER_PROJECT_TITLE, this.code);

	}

}
