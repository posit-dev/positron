/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ICommandService } from 'vs/platform/commands/common/commands';
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
	 * The proxy servers.
	 */
	private proxyServers = new Map<string, string>();

	/**
	 * The onDidStartPositronConsoleInstance event emitter.
	 */
	private readonly _onRenderHelpEmitter = this._register(new Emitter<HelpDescriptor>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param languageRuntimeService The ILanguageRuntimeService, whose Help events we listen to.
	 * @param logService The ILogService.
	 * @param openerService The IOpenerService.
	 */
	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly logService: ILogService
	) {
		// Call the base class's constructor.
		super();

		// Register our runtime event handler.
		this._register(
			this.languageRuntimeService.onDidReceiveRuntimeEvent(async languageRuntimeGlobalEvent => {
				// Process show help global events.
				if (languageRuntimeGlobalEvent.event.name === LanguageRuntimeEventType.ShowHelp) {
					// Ensure that the right event data was supplied.
					if (!isShowHelpEvent(languageRuntimeGlobalEvent.event.data)) {
						this.logService.error(`ShowHelp event supplied unsupported event data.`);
					} else {
						// Process the show help event.
						const showHelpEvent = languageRuntimeGlobalEvent.event.data as ShowHelpEvent;
						if (showHelpEvent.kind === 'url') {
							// Get the help URL.
							const helpURL = new URL(showHelpEvent.content);

							console.log(`PositronHelpService got help URL: ${helpURL.toString()}`);

							// Get the proxy server origin for the help URL. If one isn't found, ask
							// the PositronProxy to start one.
							let serverOrigin = this.proxyServers.get(helpURL.origin);
							if (!serverOrigin) {
								// Ask the PositronProxy extension for the proxy server origin.
								serverOrigin = await this.commandService.executeCommand<string>(
									'positronProxy.startProxyServer',
									helpURL.origin
								);

								if (!serverOrigin) {
									// Display an error.
									return;
								} else {
									this.proxyServers.set(helpURL.origin, serverOrigin);
								}
							}

							// Fixup the help URL.
							const serverOriginURL = new URL(serverOrigin);
							helpURL.protocol = serverOriginURL.protocol;
							helpURL.hostname = serverOriginURL.hostname;
							helpURL.port = serverOriginURL.port;

							// Raise the onRenderHelp event.
							this._onRenderHelpEmitter.fire({
								url: helpURL.toString(),
								focus: showHelpEvent.focus
							});

							console.log(`PositronHelpService is opening help URL: ${helpURL.toString()}`);

							// // For Private Alpha (August 2023), just open the help URL.
							// this.openerService.open(helpURL.toString(), {
							// 	openExternal: true
							// } satisfies OpenExternalOptions);
						} else {
							this.logService.error(`PositronHelpService does not support ${showHelpEvent.kind}.`);
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
	//#endregion Private Methods
}

// Register the Positron help service.
registerSingleton(IPositronHelpService, PositronHelpService, InstantiationType.Eager);
