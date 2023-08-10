/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { FileAccess } from 'vs/base/common/network';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { LanguageRuntimeEventType, ShowHelpEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';

// The TrustedTypePolicy for rendering.
const ttPolicyPositronHelp = window.trustedTypes?.createPolicy('positronHelp', {
	createHTML: value => value,
	createScript: value => value
});

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {
	//#region Private Properties

	/**
	 * The onDidStartPositronConsoleInstance event emitter.
	 */
	private readonly _onRenderHelpEmitter = this._register(new Emitter<string | MarkdownString>);

	//#endregion Private Properties

	//#region Constructor & Dispose

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
		languageRuntimeService.onDidReceiveRuntimeEvent(globalEvent => {
			const languageRuntimeMessageEvent = globalEvent.event;
			if (languageRuntimeMessageEvent.name === LanguageRuntimeEventType.ShowHelp) {
				const data = languageRuntimeMessageEvent.data as ShowHelpEvent;
				if (data.kind === 'markdown') {
					const markdown = new MarkdownString(data.content, true);
					this.openHelpMarkdown(markdown);
				} else if (data.kind === 'html') {
					this.openHelpHtml(data.content);
				} else if (data.kind === 'url') {
					this.openHelpUrl(data.content);
				} else {
					console.error(`[positron-help]: Unrecognized event ${data}`);
				}
			}
		});

		// this._markdownRenderer = new MarkdownRenderer({}, languageService, openerService);
		// this._store.add(this._markdownRenderer);
	}

	//#endregion Constructor & Dispose

	//#region IPositronHelpService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * The onRenderHelp event.
	 */
	readonly onRenderHelp: Event<string | MarkdownString> = this._onRenderHelpEmitter.event;

	/**
	 * Placeholder that gets called to "initialize" the PositronHelpService.
	 */
	initialize() {
	}

	//#endregion IPositronHelpService Implementation

	//#region Private Methods

	/**
	 * Opens help HTML.
	 * @param html The help HTML.
	 */
	private openHelpHtml(html: string) {
		// Ensure that we can create trusted HTML.
		if (!ttPolicyPositronHelp) {
			return;
		}

		// this._onRenderHelp.fire(html);
	}

	/**
	 * Opens help markdown.
	 * @param markdown The help markdown.
	 */
	private openHelpMarkdown(markdown: MarkdownString) {
		// Ensure that we can create trusted HTML.
		if (!ttPolicyPositronHelp) {
			return;
		}

		this.renderHelpDocument('');
		// const markdownRenderResult = this._markdownRenderer.render(markdown);
		// try {
		// 	const someOtherString = this.renderHelpDocument(markdownRenderResult.element.innerHTML);
		// 	this._onRenderHelp.fire(someOtherString);
		// } finally {
		// 	markdownRenderResult.dispose();
		// }
	}


	private openHelpUrl(url: string) {
		const html = this.renderEmbeddedHelpDocument(url);
		console.log(html);
		//this._onRenderHelp.fire(html);
	}

	private renderEmbeddedHelpDocument(url: string): string {

		const nonce = generateUuid();

		// Render the help document.
		return `
		<!DOCTYPE html>
		<html>
			<head>

				<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
				<meta http-equiv="Content-Security-Policy" content="
					default-src 'none';
					media-src https:;
					script-src 'self' 'nonce-${nonce}';
					style-src 'nonce-${nonce}';
					frame-src *;
				">

				<style nonce="${nonce}">
					body {
						font-family: sans-serif;
						font-size: 13px;
						display: flex;
						flex-direction: column;
						padding: 0;
						width: 100%;
						height: 100%;
					}
				</style>

			</head>
			<body>

				<iframe id="help-iframe"></iframe>

				<script nonce="${nonce}">
				(function() {

					// Load help tools
					var script = document.createElement("script");
					script.src = "${FileAccess.asBrowserUri('positron-help.js')}";
					script.nonce = "${nonce}";
					document.body.appendChild(script);

					// Set up iframe
					var frame = document.getElementById("help-iframe");
					frame.style.width = "100%";
					frame.style.height = "100%";
					frame.style.border = "none";
					frame.src = "${url}";

					// TODO: Not clear why this is necessary
					document.documentElement.style.width = "100%";
					document.documentElement.style.height = "100%";

				})();
				</script>
			</body>
		</html>`;
	}

	/**
	 * Renders the help document.
	 * @param helpContent The help content.
	 * @returns The help document.
	 */
	private renderHelpDocument(helpContent: string): string {
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

	//#endregion Private Methods
}

// Register the Positron help service.
registerSingleton(IPositronHelpService, PositronHelpService, InstantiationType.Delayed);
