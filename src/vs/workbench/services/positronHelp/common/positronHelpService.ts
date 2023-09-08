/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { HelpEntry, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { LanguageRuntimeEventData, LanguageRuntimeEventType, ShowHelpEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';

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
	 * The help entries.
	 */
	private helpEntries: HelpEntry[] = [];

	/**
	 * The help entry index.
	 */
	private helpEntryIndex = -1;

	/**
	 * The render help timeout. Used to "debounce" help rendering.
	 */
	private renderHelpTimeout?: NodeJS.Timeout;

	/**
	 * The proxy servers. Keyed by the target URL origin.
	 */
	private proxyServers = new Map<string, string>();

	/**
	 * The onRenderHelp event emitter.
	 */
	private readonly onRenderHelpEmitter = this._register(new Emitter<HelpEntry>);

	/**
	 * The onFocusHelp event emitter.
	 */
	private readonly onFocusHelpEmitter = this._register(new Emitter<void>);

	/**
	 * The onHelpLoaded event emitter.
	 */
	private readonly onHelpLoadedEmitter = this._register(new Emitter<HelpEntry>);

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
					this.logService.error(`PositronHelpService does not support help event kind ${showHelpEvent.kind}.`);
					return;
				}

				// Get the target URL.
				const targetUrl = new URL(showHelpEvent.content);

				// Logging.
				this.logService.info(`PositronHelpService language runtime server sent show help event for: ${targetUrl.toString()}`);

				// If the target URL is not for localhost, open it externally.
				if (!isLocalhost(targetUrl.hostname)) {
					try {
						await this.openerService.open(targetUrl.toString(), {
							openExternal: true
						} satisfies OpenExternalOptions);
					} catch {
						this.notificationService.error(nls.localize(
							'positronHelpServiceOpenFailed',
							"The Positron help service was unable to open '{0}'.", targetUrl.toString()
						));
					}

					// Return.
					return;
				}

				// Get the proxy server origin for the help URL. If one isn't found, ask the
				// PositronProxy to start one.
				let proxyServerOrigin = this.proxyServers.get(targetUrl.origin);
				if (!proxyServerOrigin) {
					// Try to start a help proxy server.
					try {
						proxyServerOrigin = await this.commandService.executeCommand<string>(
							'positronProxy.startHelpProxyServer',
							targetUrl.origin
						);
					} catch (error) {
						this.logService.error(`PositronHelpService could not start the proxy server for ${targetUrl.origin}.`);
						this.logService.error(error);
					}

					// If the help proxy server could not be started, notify the user, and return.
					if (!proxyServerOrigin) {
						this.notificationService.error(nls.localize(
							'positronHelpServiceUnavailable',
							"The Positron help service is unavailable."
						));
						return;
					}

					// Add the proxy server.
					this.proxyServers.set(targetUrl.origin, proxyServerOrigin);
				}

				// Create the source URL.
				const sourceUrl = new URL(targetUrl);
				const proxyServerOriginUrl = new URL(proxyServerOrigin);
				sourceUrl.protocol = proxyServerOriginUrl.protocol;
				sourceUrl.hostname = proxyServerOriginUrl.hostname;
				sourceUrl.port = proxyServerOriginUrl.port;

				// Get the runtime.
				const runtime = this.languageRuntimeService.getRuntime(
					languageRuntimeGlobalEvent.runtime_id
				);

				// Basically this can't happen.
				if (!runtime) {
					this.notificationService.error(nls.localize(
						'positronHelpServiceInternalError',
						"The Positron help service experienced an unexpected error."
					));
					return;
				}

				// Create the help entry.
				const helpEntry: HelpEntry = {
					languageId: runtime.metadata.languageId,
					runtimeId: runtime.metadata.runtimeId,
					languageName: runtime.metadata.languageName,
					sourceUrl: sourceUrl.toString(),
					targetUrl: targetUrl.toString()
				};

				// Ensure that the auxiliary bar is showing and open the help view.
				await this.commandService.executeCommand('workbench.action.showAuxiliaryBar');
				await this.commandService.executeCommand('workbench.action.positron.openHelp');

				// Add the help entry.
				this.addHelpEntry(helpEntry);

				// Raise the onFocusHelp event, if we should.
				if (showHelpEvent.focus) {
					this.onFocusHelpEmitter.fire();
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
	readonly onRenderHelp = this.onRenderHelpEmitter.event;

	/**
	 * The onFocusHelp event.
	 */
	readonly onFocusHelp = this.onFocusHelpEmitter.event;

	/**
	 * The onHelpLoaded event.
	 */
	readonly onHelpLoaded = this.onHelpLoadedEmitter.event;

	/**
	 * Gets the current help entry.
	 */
	get currentHelpEntry() {
		return this.helpEntryIndex > -1 ? this.helpEntries[this.helpEntryIndex] : undefined;
	}

	/**
	 * Gets a value which indicates whether help can navigate back.
	 */
	get canNavigateBackward() {
		return this.helpEntryIndex > 0;
	}

	/**
	 * Gets a value which indicates whether help can navigate forward.
	 */
	get canNavigateForward() {
		return this.helpEntryIndex < this.helpEntries.length - 1;
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronHelpService.
	 */
	initialize() {
	}

	/**
	 * Called to indicate that help has loaded.
	 * @param url The URL of the help that was loaded.
	 * @param title The title of the help that was loaded.
	 */
	async helpLoaded(url: string, title: string): Promise<void> {
		// Logging.
		this.logService.info(`PositronHelpService help loaded for: ${url} ${title}`);

		// Find the first occurence of the URL, set its title, and raise the onHelpLoaded event.
		for (let i = this.helpEntries.length - 1; i >= 0; i--) {
			const helpEntry = this.helpEntries[i];
			if (helpEntry && helpEntry.sourceUrl === url) {
				// Set the title.
				helpEntry.title = title;

				// Ensure that the auxiliary bar is showing and open the help view.
				await this.commandService.executeCommand('workbench.action.showAuxiliaryBar');
				await this.commandService.executeCommand('workbench.action.positron.openHelp');

				// Raise the onHelpLoaded event.
				this.onHelpLoadedEmitter.fire(helpEntry);
			}
		}
	}

	/**
	 * Navigates the help service.
	 * @param fromUrl The from URL.
	 * @param toUrl The to URL.
	 */
	navigate(fromUrl: string, toUrl: string) {
		const currentHelpEntry = this.helpEntries[this.helpEntryIndex];
		if (currentHelpEntry && currentHelpEntry.sourceUrl === fromUrl) {
			// Create the target URL.
			const currentTargetUrl = new URL(currentHelpEntry.targetUrl);
			const targetUrl = new URL(toUrl);
			targetUrl.protocol = currentTargetUrl.protocol;
			targetUrl.hostname = currentTargetUrl.hostname;
			targetUrl.port = currentTargetUrl.port;

			// Add the help entry.
			this.addHelpEntry({
				...currentHelpEntry,
				sourceUrl: toUrl,
				targetUrl: targetUrl.toString(),
				title: undefined
			});
		}
	}

	/**
	 * Navigates backward.
	 */
	navigateBackward() {
		// Navigate backward, if we can.
		if (this.helpEntryIndex > 0) {
			this.helpEntryIndex--;
			this.renderHelp();
		}
	}

	/**
	 * Navigates forward.
	 */
	navigateForward() {
		// Navigate forward, if we can.
		if (this.helpEntryIndex < this.helpEntries.length - 1) {
			this.helpEntryIndex++;
			this.renderHelp();
		}
	}

	//#endregion IPositronHelpService Implementation

	//#region Private Methods

	/**
	 * Adds a help entry.
	 * @param helpEntry The help entry to add.
	 */
	private addHelpEntry(helpEntry: HelpEntry) {
		// Push the help entry. We may not render it, but it needs to be in the history.
		this.helpEntries.push(helpEntry);
		this.helpEntryIndex = this.helpEntries.length - 1;

		// Render help.
		this.renderHelp();
	}

	/**
	 * Renders help.
	 */
	private renderHelp() {
		// Clear the render help timeout.
		if (this.renderHelpTimeout) {
			clearTimeout(this.renderHelpTimeout);
			this.renderHelpTimeout = undefined;
		}

		// Start the render help timeout.
		this.renderHelpTimeout = setTimeout(() => {
			// Clear the timeout.
			this.renderHelpTimeout = undefined;

			// Get the help entry to render.
			const helpEntry = this.helpEntries[this.helpEntryIndex];

			// Raise the onRenderHelp event to render the most recent help entry.
			this.onRenderHelpEmitter.fire(helpEntry);
		}, 500);
	}

	//#endregion Private Methods
}

// Register the Positron help service.
registerSingleton(IPositronHelpService, PositronHelpService, InstantiationType.Eager);
