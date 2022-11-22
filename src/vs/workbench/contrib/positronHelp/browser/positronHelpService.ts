/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {

	declare readonly _serviceBrand: undefined;

	// The onSizeChanged event.
	private _onRenderHelp = this._register(new Emitter<string>());
	readonly onRenderHelp: Event<string> = this._onRenderHelp.event;

	openHelpMarkdown(markdown: string) {
		console.log(`+++++++++++++++ PositronHelpService openHelpMarkdown ${markdown}`);
		this._onRenderHelp.fire('jajaj');
	}

	openHelpURL(url: string) {
		console.log(`+++++++++++++++ PositronHelpService openHelpURL ${url}`);
	}

	findTextChanged(findText: string) {
		console.log(`+++++++++++++++ PositronHelpService findTextChanged ${findText}`);
	}

	findPrevious() {
		console.log('+++++++++++++++ PositronHelpService findPrevious');
	}

	findNext() {
		console.log('+++++++++++++++ PositronHelpService findNext');
	}
}
