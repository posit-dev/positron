/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { HelpDescriptor, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { LanguageRuntimeEventData, LanguageRuntimeEventType, ShowHelpEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';

/**
 * Determines whether a hostname represents localhost.
 * @param hostname The hostname.
 * @returns A value which indicates whether a hostname represents localhost.
 */
const isLocalhost = (hostname?: string) =>
	!!(hostname && ['localhost', '127.0.0.1', '::1'].indexOf(hostname.toLowerCase()) > -1);

/**
* Custom custom type guard for ShowHelpEvent.
* @param _ The LanguageRuntimeEventData that should be a ShowHelpEvent.
* @returns true if the LanguageRuntimeEventData is a ShowHelpEvent; otherwise, false.
*/
const isShowHelpEvent = (_: LanguageRuntimeEventData): _ is ShowHelpEvent => {
	return (_ as ShowHelpEvent).kind !== undefined;
};

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
	private readonly onRenderHelpEmitter = this._register(new Emitter<HelpDescriptor>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param commandService The ICommandService.
	 * @param languageRuntimeService The ICommandService.
	 * @param logService The ILogService.
	 * @param notificationService The INotificationService.
	 * @param openerService The IOpenerService.
	 */
	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService
	) {
		// Call the base class's constructor.
		super();

		// Register a runtime global event handler.
		this._register(
			this.languageRuntimeService.onDidReceiveRuntimeEvent(async languageRuntimeGlobalEvent => {
				// Show help event types are supported.
				if (languageRuntimeGlobalEvent.event.name !== LanguageRuntimeEventType.ShowHelp) {
					return;
				}

				// Ensure that the right event data was supplied.
				if (!isShowHelpEvent(languageRuntimeGlobalEvent.event.data)) {
					this.logService.error(`ShowHelp event supplied unsupported event data.`);
					return;
				}

				// Get the show help event.
				const showHelpEvent = languageRuntimeGlobalEvent.event.data as ShowHelpEvent;

				// Only url help events are supported.
				if (showHelpEvent.kind !== 'url') {
					this.logService.error(`PositronHelpService does not support ${showHelpEvent.kind}.`);
					return;
				}

				// Get the help URL.
				const helpURL = new URL(showHelpEvent.content);

				// If the help URL is not for localhost, open it externally.
				if (!isLocalhost(helpURL.hostname)) {
					this.openerService.open(helpURL.toString(), {
						openExternal: true
					} satisfies OpenExternalOptions);
					return;
				}

				// Get the proxy server origin for the help URL. If one isn't found, ask
				// the PositronProxy to start one.
				let serverOrigin = this.proxyServers.get(helpURL.origin);
				if (!serverOrigin) {
					// Try to start a help proxy server.
					try {
						serverOrigin = await this.commandService.executeCommand<string>(
							'positronProxy.startHelpProxyServer',
							helpURL.origin
						);
					} catch (error) {
						this.logService.error(`PositronHelpService could not start the proxy server for ${helpURL.origin}.`);
					}

					// If the help proxy server could not be started, notify the user, and return.
					if (!serverOrigin) {
						this.notificationService.error(nls.localize(
							'positronHelpServiceUnavailable',
							"The Positron help service is unavailable."
						));
						return;
					}

					// Add the proxy server.
					this.proxyServers.set(helpURL.origin, serverOrigin);
				}

				// Fixup the help URL.
				const serverOriginURL = new URL(serverOrigin);
				helpURL.protocol = serverOriginURL.protocol;
				helpURL.hostname = serverOriginURL.hostname;
				helpURL.port = serverOriginURL.port;

				// Raise the onRenderHelp event.
				this.onRenderHelpEmitter.fire({
					url: helpURL.toString(),
					focus: showHelpEvent.focus
				});
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
	readonly onRenderHelp = this.onRenderHelpEmitter.event;

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
