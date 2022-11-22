/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IHelpResult, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';
import { MarkdownRenderer } from 'vs/editor/contrib/markdownRenderer/browser/markdownRenderer';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { MarkdownString } from 'vs/base/common/htmlContent';

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {

	declare readonly _serviceBrand: undefined;

	private _markdownRenderer: MarkdownRenderer;

	// The onSizeChanged event.
	private _onRenderHelp = this._register(new Emitter<IHelpResult>());
	readonly onRenderHelp: Event<IHelpResult> = this._onRenderHelp.event;

	constructor(
		@ILanguageService languageService: ILanguageService,
		@IOpenerService openerService: IOpenerService
	) {
		super();

		this._markdownRenderer = new MarkdownRenderer({}, languageService, openerService);
		this._store.add(this._markdownRenderer);
	}

	openHelpMarkdown(markdown: MarkdownString) {
		console.log(`+++++++++++++++ PositronHelpService openHelpMarkdown ${markdown}`);

		const result = this._markdownRenderer.render(markdown);
		console.log('Rendered result:');
		console.log(result);
		this._onRenderHelp.fire(result);
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
