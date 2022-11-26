/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';
import { IMarkdownRenderResult, MarkdownRenderer } from 'vs/editor/contrib/markdownRenderer/browser/markdownRenderer';
import { FileAccess } from 'vs/base/common/network';

// The TrustedTypePolicy for the Positron help renderer.
export const ttPolicyPositronHelp = window.trustedTypes?.createPolicy('positronHelp', {
	createHTML: value => value,
	createScript: value => value
});

//const baseUrl = '../../../../';

const baseUrl = './oss-dev/static/out/';

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {

	declare readonly _serviceBrand: undefined;

	// The markdown renderer.
	private _markdownRenderer: MarkdownRenderer;

	// The current markdown render result.
	private _markdownRenderResult?: IMarkdownRenderResult;

	// The onSizeChanged event.
	private _onRenderHelp = this._register(new Emitter<TrustedHTML | undefined>());
	readonly onRenderHelp: Event<TrustedHTML | undefined> = this._onRenderHelp.event;

	/**
	 * Constructor.
	 * @param languageService The ILanguageService for the markdown renderer.
	 * @param openerService The IOpenerService for the markdown renderer.
	 */
	constructor(
		@ILanguageService languageService: ILanguageService,
		@IOpenerService openerService: IOpenerService
	) {
		super();
		this._markdownRenderer = new MarkdownRenderer({}, languageService, openerService);
		this._store.add(this._markdownRenderer);

		const yack = FileAccess.asBrowserUri('positron-help.js');
		console.log(`we would look in ${yack}`);
	}

	/**
	 * Opens the specified help markdown.
	 * @param markdown The help markdown.
	 */
	openHelpMarkdown(markdown: MarkdownString) {
		// Ensure that we can create trusted HTML.
		if (!ttPolicyPositronHelp) {
			return;
		}

		console.log(baseUrl);

		const markdownRenderResult = this._markdownRenderer.render(markdown);
		try {
			const someOtherString = this.renderHelpDocument(markdownRenderResult.element.innerHTML);
			const sdf = ttPolicyPositronHelp.createHTML(someOtherString);
			this._onRenderHelp.fire(sdf);
		} finally {
			markdownRenderResult.dispose();
		}
	}

	/**
	 * Opens the specified help URL.
	 * @param url The help URL.
	 */
	openHelpURL(url: string) {
		console.log(`+++++++++++++++ PositronHelpService openHelpURL ${url}`);
	}

	/**
	 * Performs a find operation.
	 * @param findText The find text.
	 */
	find(findText: string) {
		// If find is not possible, return.
		if (!ttPolicyPositronHelp || !this._markdownRenderResult) {
			return;
		}

		// If there's no find text, return the help.
		if (findText === '') {
			this._onRenderHelp.fire(ttPolicyPositronHelp.createHTML(this._markdownRenderResult.element.innerHTML));
			return;
		}

		const regex = new RegExp(findText, 'gi');

		// const yack = this._markdownRenderResult.element.innerHTML = ttPolicyPositronHelp.createHTML(this._markdownRenderResult.element.innerHTML.replace(regex, '<mark>$&</mark>')) as unknown as string;

		this._onRenderHelp.fire(ttPolicyPositronHelp.createHTML(this._markdownRenderResult.element.innerHTML.replace(regex, '<mark>$&</mark>')));
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

	/**
	 * Renders the help document.
	 * @param helpContent The help content.
	 * @returns The help document.
	 */
	renderHelpDocument(helpContent: string): string {
		const nonce = generateUuid();

		return `<!DOCTYPE html>
		<html>
			<head>
				<meta http-equiv="Content-type" content="text/html;charset=UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src https:; script-src 'self'; style-src 'nonce-${nonce}';">
				<style nonce="${nonce}">
					body {
						display: flex;
						flex-direction: column;
						padding: 0;
						height: inherit;
					}
				</style>
				<script src="${FileAccess.asBrowserUri('positron-help.js')}"></script>
			</head>
			<body>
				<div>Hello</div>
				${helpContent}
			</body>
		</html>`;
	}
}
