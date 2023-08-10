/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
// import { generateUuid } from 'vs/base/common/uuid';
// import { FileAccess } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { HelpDescriptor, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { LanguageRuntimeEventData, LanguageRuntimeEventType, ShowHelpEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';

/**
 * Custom custom type guard for ShowHelpEvent.
 * @param _ The LanguageRuntimeEventData that should be a ShowHelpEvent.
 * @returns true if the LanguageRuntimeEventData is a ShowHelpEvent; otherwise, false.
 */
const isShowHelpEvent = (_: LanguageRuntimeEventData): _ is ShowHelpEvent => {
	return (_ as ShowHelpEvent).kind !== undefined;
};

// // The TrustedTypePolicy for rendering.
// const ttPolicyPositronHelp = window.trustedTypes?.createPolicy('positronHelp', {
// 	createHTML: value => value,
// 	createScript: value => value
// });

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {
	//#region Private Properties

	/**
	 * The onDidStartPositronConsoleInstance event emitter.
	 */
	private readonly _onRenderHelpEmitter = this._register(new Emitter<HelpDescriptor>);

	private readonly _history: string[] = [];

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param languageService The ILanguageService for the markdown renderer.
	 * @param openerService The IOpenerService for the markdown renderer.
	 * @param languageRuntimeService The ILanguageRuntimeService, whose Help events we listen to.
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private _logService: ILogService,
	) {
		// Call the base class's constructor.
		super();

		// Register our runtime event handler.
		this._register(
			this._languageRuntimeService.onDidReceiveRuntimeEvent(languageRuntimeGlobalEvent => {
				// Process show help global events.
				if (languageRuntimeGlobalEvent.event.name === LanguageRuntimeEventType.ShowHelp) {
					// Ensure that the right event data was supplied.
					if (!isShowHelpEvent(languageRuntimeGlobalEvent.event.data)) {
						this._logService.error(`ShowHelp event supplied unsupported event data.`);
					} else {
						// Process the show help event.
						const showHelpEvent = languageRuntimeGlobalEvent.event.data as ShowHelpEvent;
						if (showHelpEvent.kind === 'url') {
							this._history.unshift(showHelpEvent.content);
							this._onRenderHelpEmitter.fire({
								url: showHelpEvent.content,
								focus: showHelpEvent.focus
							});
						} else {
							this._logService.error(`PositronHelpService does not support ${showHelpEvent.kind}.`);
						}
					}
				}
			})
		);
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
	readonly onRenderHelp = this._onRenderHelpEmitter.event;

	/**
	 * Placeholder that gets called to "initialize" the PositronHelpService.
	 */
	initialize() {
	}

	//#endregion IPositronHelpService Implementation

	//#region Private Methods

	// private openHelpUrl(url: string) {
	// 	const html = this.renderEmbeddedHelpDocument(url);
	// 	console.log(html);
	// 	//this._onRenderHelp.fire(html);
	// }

	// 	private renderEmbeddedHelpDocument(url: string): string {

	// 		const nonce = generateUuid();

	// 		// Render the help document.
	// 		return `
	// <!DOCTYPE html>
	// <html>
	// 	<head>
	// 		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
	// 		<meta http-equiv="Content-Security-Policy" content="
	// 			default-src 'none';
	// 			media-src https:;
	// 			script-src 'self' 'nonce-${nonce}';
	// 			style-src 'nonce-${nonce}';
	// 			frame-src *;
	// 		">
	// 		<style nonce="${nonce}">
	// 			body {
	// 				font-family: sans-serif;
	// 				font-size: 13px;
	// 				display: flex;
	// 				flex-direction: column;
	// 				padding: 0;
	// 				width: 100%;
	// 				height: 100%;
	// 			}
	// 		</style>
	// 	</head>
	// 	<body>
	// 		<iframe id="help-iframe"></iframe>
	// 		<script nonce="${nonce}">
	// 		(function() {
	// 			// Load help tools
	// 			var script = document.createElement("script");
	// 			script.src = "${FileAccess.asBrowserUri('positron-help.js')}";
	// 			script.nonce = "${nonce}";
	// 			document.body.appendChild(script);

	// 			// Set up iframe
	// 			var frame = document.getElementById("help-iframe");
	// 			frame.style.width = "100%";
	// 			frame.style.height = "100%";
	// 			frame.style.border = "none";
	// 			frame.src = "${url}";

	// 			// TODO: Not clear why this is necessary
	// 			document.documentElement.style.width = "100%";
	// 			document.documentElement.style.height = "100%";
	// 		})();
	// 		</script>
	// 	</body>
	// </html>`;
	// 	}

	//#endregion Private Methods
}

// Register the Positron help service.
registerSingleton(IPositronHelpService, PositronHelpService, InstantiationType.Eager);
