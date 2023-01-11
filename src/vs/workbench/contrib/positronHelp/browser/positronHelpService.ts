/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { FileAccess } from 'vs/base/common/network';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';
import { MarkdownRenderer } from 'vs/editor/contrib/markdownRenderer/browser/markdownRenderer';
import { ILanguageRuntimeMessageEvent, ILanguageRuntimeService, LanguageRuntimeMessageType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { LanguageRuntimeEventType, ShowHelpEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';

// The TrustedTypePolicy for rendering.
const ttPolicyPositronHelp = window.trustedTypes?.createPolicy('positronHelp', {
	createHTML: value => value,
	createScript: value => value
});

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {

	declare readonly _serviceBrand: undefined;

	// The markdown renderer.
	private _markdownRenderer: MarkdownRenderer;

	// The onSizeChanged event.
	private _onRenderHelp = this._register(new Emitter<TrustedHTML | undefined>());
	readonly onRenderHelp: Event<TrustedHTML | undefined> = this._onRenderHelp.event;

	/**
	 * Constructor.
	 * @param languageService The ILanguageService for the markdown renderer.
	 * @param openerService The IOpenerService for the markdown renderer.
	 * @param languageRuntimeService The ILanguageRuntimeService, whose Help events we listen to.
	 */
	constructor(
		@ILanguageService languageService: ILanguageService,
		@IOpenerService openerService: IOpenerService,
		@ILanguageRuntimeService languageRuntimeService: ILanguageRuntimeService,
	) {
		super();

		// Listen for language runtime Help events.
		languageRuntimeService.onDidStartRuntime(runtime => {
			runtime.onDidReceiveRuntimeMessage(message => {
				if (message.type === LanguageRuntimeMessageType.Event) {
					const event = message as ILanguageRuntimeMessageEvent;
					if (event.name === LanguageRuntimeEventType.ShowHelp) {
						const data = event.data as ShowHelpEvent;
						if (data.kind === 'markdown') {
							const markdown = new MarkdownString(data.content, true);
							this.openHelpMarkdown(markdown);
						} else {
							this.openHelpHtml(data.content);
						}
					}
				}
			});
		});

		this._markdownRenderer = new MarkdownRenderer({}, languageService, openerService);
		this._store.add(this._markdownRenderer);
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

		const markdownRenderResult = this._markdownRenderer.render(markdown);
		try {
			const someOtherString = this.renderHelpDocument(markdownRenderResult.element.innerHTML);
			const sdf = ttPolicyPositronHelp.createHTML(someOtherString);
			this._onRenderHelp.fire(sdf);
		} finally {
			markdownRenderResult.dispose();
		}
	}

	openHelpHtml(html: string) {
		// Ensure that we can create trusted HTML.
		if (!ttPolicyPositronHelp) {
			return;
		}

		const trustedHtml = ttPolicyPositronHelp.createHTML(html);
		this._onRenderHelp.fire(trustedHtml);
	}


	/**
	 * Renders the help document.
	 * @param helpContent The help content.
	 * @returns The help document.
	 */
	renderHelpDocument(helpContent: string): string {
		// Create the nonce.
		const nonce = generateUuid();

		// Render the help document.
		return `
		<!DOCTYPE html>
		<html>
			<head>
				<meta http-equiv="Content-type" content="text/html;charset=UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src https:; script-src 'self'; style-src 'nonce-${nonce}';">
				<style nonce="${nonce}">
					body {
						background: transparent;
						font-family: sans-serif;
						font-size: 13px;
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
