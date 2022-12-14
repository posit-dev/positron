/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
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
import { ILanguageRuntimeEvent, ILanguageRuntimeService, LanguageRuntimeMessageType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { LanguageRuntimeEventType, ShowHelpUrlEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';
import { URI } from 'vs/base/common/uri';

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

	// The onRenderHelp event.
	private _onRenderHelp = this._register(new Emitter<TrustedHTML | undefined>());
	readonly onRenderHelp: Event<TrustedHTML | undefined> = this._onRenderHelp.event;

	// The onShowHelpUrl event.
	private _onShowHelpUrl = this._register(new Emitter<URI>());
	readonly onShowHelpUrl: Event<URI> = this._onShowHelpUrl.event;

	/**
	 * Constructor.
	 * @param languageService The ILanguageService for the markdown renderer.
	 * @param openerService The IOpenerService for the markdown renderer.
	 * @param languageRuntimeService The language runtime service, whose runtimes will emit Help events.
	 */
	constructor(
		@ILanguageService languageService: ILanguageService,
		@IOpenerService openerService: IOpenerService,
		@ILanguageRuntimeService languageRuntimeService: ILanguageRuntimeService,
	) {
		super();

		// Listen for runtime events relevant to the Help service.
		//
		// TODO (kevin): use a more explicit interface for listening to
		// language runtime events, rather than connecting through the
		// language runtime service.
		//
		// TODO (kevin): is it possible that the help service could be
		// instantiated _after_ a runtime was started? do we need to do
		// anything explicit to force sequencing of startup events here?
		languageRuntimeService.onDidStartRuntime(runtime => {
			runtime.onDidReceiveRuntimeMessage(message => {
				if (message.type === LanguageRuntimeMessageType.Event) {
					const event = message as ILanguageRuntimeEvent;
					if (event.name === LanguageRuntimeEventType.ShowHelpUrl) {
						const data = event.data as ShowHelpUrlEvent;
						this.openHelpUrl(data.url);
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

	/**
	 * Opens the specified help URL.
	 * @param url The help URL.
	 */
	openHelpUrl(url: string) {
		const uri = URI.parse(url, true);
		this._onShowHelpUrl.fire(uri);
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
