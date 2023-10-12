/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { FileAccess } from 'vs/base/common/network';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IViewsService } from 'vs/workbench/common/views';
import { IFileService } from 'vs/platform/files/common/files';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { isLocalhost } from 'vs/workbench/contrib/positronHelp/browser/utils';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { HelpEntry, IHelpEntry } from 'vs/workbench/contrib/positronHelp/browser/helpEntry';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService, createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { LanguageRuntimeEventData, LanguageRuntimeEventType, ShowHelpEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';

/**
 * The help HTML file path.
 */
const HELP_HTML_FILE_PATH = 'vs/workbench/contrib/positronHelp/browser/resources/help.html';

/**
 * The Positron help view ID.
 */
export const POSITRON_HELP_VIEW_ID = 'workbench.panel.positronHelp';

/**
 * Positron help service ID.
 */
export const POSITRON_HELP_SERVICE_ID = 'positronHelpService';

/**
 * IPositronHelpService interface.
 */
export interface IPositronHelpService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Gets the help entries.
	 */
	readonly helpEntries: IHelpEntry[];

	/**
	 * Gets the current help entry.
	 */
	readonly currentHelpEntry?: IHelpEntry;

	/**
	 * Gets a value which indicates whether help can navigate backward.
	 */
	readonly canNavigateBackward: boolean;

	/**
	 * Gets a value which indicates whether help can navigate forward.
	 */
	readonly canNavigateForward: boolean;

	/**
	 * The onDidFocusHelp event.
	 */
	readonly onDidFocusHelp: Event<void>;

	/**
	 * The onDidChangeCurrentHelpEntry event.
	 */
	readonly onDidChangeCurrentHelpEntry: Event<IHelpEntry | undefined>;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize(): void;

	/**
	 * Opens the specified help entry index.
	 * @param helpEntryIndex The help entry index to open.
	 */
	openHelpEntryIndex(helpEntryIndex: number): void;

	/**
	 * Navigates the help service.
	 * @param fromUrl The from URL.
	 * @param toUrl The to URL.
	 */
	navigate(fromUrl: string, toUrl: string): void;

	/**
	 * Navigates backward.
	 */
	navigateBackward(): void;

	/**
	 * Navigates forward.
	 */
	navigateForward(): void;
}

/**
 * PositronHelpService class.
 */
class PositronHelpService extends Disposable implements IPositronHelpService {
	//#region Private Properties

	/**
	 * Gets or sets the help HTML.
	 */
	private _helpHTML = '<!DOCTYPE html><html><body></body></html>';

	/**
	 * Gets or sets the help entries.
	 */
	private _helpEntries: HelpEntry[] = [];

	/**
	 * Gets or sets the help entry index.
	 */
	private _helpEntryIndex = -1;

	/**
	 * Gets the proxy servers. Keyed by the target URL origin.
	 */
	private readonly _proxyServers = new Map<string, string>();

	/**
	 * The onDidFocusHelp event emitter.
	 */
	private readonly _onDidFocusHelpEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidChangeCurrentHelpEntry event emitter.
	 */
	private readonly _onDidChangeCurrentHelpEntryEmitter =
		this._register(new Emitter<IHelpEntry | undefined>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _commandService The ICommandService.
	 * @param _fileService The IFileService.
	 * @param _instantiationService The IInstantiationService.
	 * @param _languageRuntimeService The ICommandService.
	 * @param _logService The ILogService.
	 * @param _notificationService The INotificationService.
	 * @param _openerService The IOpenerService.
	 * @param _viewsService The IViewsService.
	 */
	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IThemeService private readonly _themeService: IThemeService,
		@IViewsService private readonly _viewsService: IViewsService

	) {
		// Call the base class's constructor.
		super();

		// Load the help HTML file.
		this._fileService.readFile(FileAccess.asFileUri(HELP_HTML_FILE_PATH))
			.then(fileContent => this._helpHTML = fileContent.value.toString());

		// Register onDidColorThemeChange handler.
		this._register(this._themeService.onDidColorThemeChange(async colorTheme => {
			// Create a webview theme data provider. It's a convenient way to get the styles we need
			// for the help prosy server. Get the webview styles.
			const webviewThemeDataProvider = _instantiationService.createInstance(WebviewThemeDataProvider);
			const { styles } = webviewThemeDataProvider.getWebviewThemeData();
			webviewThemeDataProvider.dispose();

			// Try to set the help proxy server styles.
			try {
				await this._commandService.executeCommand(
					'positronProxy.setHelpProxyServerStyles',
					styles
				);
			} catch (error) {
				this._logService.error('PositronHelpService could not set the proxy server styles');
				this._logService.error(error);
			}
		}));

		// Register onDidReceiveRuntimeEvent handler.
		this._register(
			this._languageRuntimeService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
				// When a language runtime shuts down, delete its help entries.
				switch (languageRuntimeStateEvent.new_state) {
					case RuntimeState.Restarting:
					case RuntimeState.Exiting:
					case RuntimeState.Exited:
					case RuntimeState.Offline:
						this.deleteLanguageRuntimeHelpEntries(languageRuntimeStateEvent.runtime_id);
						break;
				}
			})
		);

		// Register onDidReceiveRuntimeEvent handler.
		this._register(
			this._languageRuntimeService.onDidReceiveRuntimeEvent(async languageRuntimeGlobalEvent => {
				/**
				 * Custom custom type guard for ShowHelpEvent.
				 * @param _ The LanguageRuntimeEventData that should be a ShowHelpEvent.
				 * @returns true if the LanguageRuntimeEventData is a ShowHelpEvent; otherwise, false.
				 */
				const isShowHelpEvent = (_: LanguageRuntimeEventData): _ is ShowHelpEvent => {
					return (_ as ShowHelpEvent).kind !== undefined;
				};

				// Show help event types are supported.
				if (languageRuntimeGlobalEvent.event.name !== LanguageRuntimeEventType.ShowHelp) {
					return;
				}

				// Ensure that the right event data was supplied.
				if (!isShowHelpEvent(languageRuntimeGlobalEvent.event.data)) {
					this._logService.error(`ShowHelp event supplied unsupported event data.`);
					return;
				}

				// Get the show help event.
				const showHelpEvent = languageRuntimeGlobalEvent.event.data as ShowHelpEvent;

				// Only url help events are supported.
				if (showHelpEvent.kind !== 'url') {
					this._logService.error(`PositronHelpService does not support help event kind ${showHelpEvent.kind}.`);
					return;
				}

				// Get the target URL.
				const targetUrl = new URL(showHelpEvent.content);

				// Logging.
				this._logService.info(`PositronHelpService language runtime server sent show help event for: ${targetUrl.toString()}`);

				// If the target URL is not for localhost, open it externally.
				if (!isLocalhost(targetUrl.hostname)) {
					try {
						await this._openerService.open(targetUrl.toString(), {
							openExternal: true
						} satisfies OpenExternalOptions);
					} catch {
						this._notificationService.error(localize(
							'positronHelpServiceOpenFailed',
							"The Positron help service was unable to open '{0}'.", targetUrl.toString()
						));
					}

					// Return.
					return;
				}

				// Get the proxy server origin for the help URL. If one isn't found, ask the
				// PositronProxy to start one.
				let proxyServerOrigin = this._proxyServers.get(targetUrl.origin);
				if (!proxyServerOrigin) {
					// Try to start a help proxy server.
					try {
						proxyServerOrigin = await this._commandService.executeCommand<string>(
							'positronProxy.startHelpProxyServer',
							targetUrl.origin
						);
					} catch (error) {
						this._logService.error(`PositronHelpService could not start the proxy server for ${targetUrl.origin}.`);
						this._logService.error(error);
					}

					// If the help proxy server could not be started, notify the user, and return.
					if (!proxyServerOrigin) {
						this._notificationService.error(localize(
							'positronHelpServiceUnavailable',
							"The Positron help service is unavailable."
						));
						return;
					}

					// Add the proxy server.
					this._proxyServers.set(targetUrl.origin, proxyServerOrigin);
				}

				// Create the source URL.
				const sourceUrl = new URL(targetUrl);
				const proxyServerOriginUrl = new URL(proxyServerOrigin);
				sourceUrl.protocol = proxyServerOriginUrl.protocol;
				sourceUrl.hostname = proxyServerOriginUrl.hostname;
				sourceUrl.port = proxyServerOriginUrl.port;

				// Get the runtime.
				const runtime = this._languageRuntimeService.getRuntime(
					languageRuntimeGlobalEvent.runtime_id
				);

				// Basically this can't happen.
				if (!runtime) {
					this._notificationService.error(localize(
						'positronHelpServiceInternalError',
						"The Positron help service experienced an unexpected error."
					));
					return;
				}

				// Open the help view.
				await this._viewsService.openView(POSITRON_HELP_VIEW_ID, false);

				// Create the help entry.
				const helpEntry = this._instantiationService.createInstance(HelpEntry,
					this._helpHTML,
					runtime.metadata.languageId,
					runtime.metadata.runtimeId,
					runtime.metadata.languageName,
					sourceUrl.toString(),
					targetUrl.toString()
				);

				// Add the onDidNavigate event handler.
				helpEntry.onDidNavigate(url => {
					this.navigate(helpEntry.sourceUrl, url);
				});

				// Add the onDidNavigateBackward event handler.
				helpEntry.onDidNavigateBackward(() => {
					this.navigateBackward();
				});

				// Add the onDidNavigateForward event handler.
				helpEntry.onDidNavigateForward(() => {
					this.navigateForward();
				});

				// Add the help entry.
				this.addHelpEntry(helpEntry);

				// Raise the onDidFocusHelp event, if we should.
				if (showHelpEvent.focus) {
					this._onDidFocusHelpEmitter.fire();
				}
			})
		);
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Dispose of the help entries.
		this._helpEntries.forEach(helpEntry => helpEntry.dispose());

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronHelpService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * The help entries.
	 */
	public get helpEntries(): IHelpEntry[] {
		return this._helpEntries;
	}

	/**
	 * Gets the current help entry.
	 */
	get currentHelpEntry(): IHelpEntry {
		return this._helpEntries[this._helpEntryIndex];
	}

	/**
	 * Gets a value which indicates whether help can navigate back.
	 */
	get canNavigateBackward() {
		return this._helpEntryIndex > 0;
	}

	/**
	 * Gets a value which indicates whether help can navigate forward.
	 */
	get canNavigateForward() {
		return this._helpEntryIndex < this._helpEntries.length - 1;
	}

	/**
	 * The onDidFocusHelp event.
	 */
	readonly onDidFocusHelp = this._onDidFocusHelpEmitter.event;

	/**
	 * The onDidChangeCurrentHelpEntry event.
	 */
	readonly onDidChangeCurrentHelpEntry = this._onDidChangeCurrentHelpEntryEmitter.event;

	/**
	 * Placeholder that gets called to "initialize" the PositronHelpService.
	 */
	initialize() {
	}

	/**
	 * Opens the specified help entry index.
	 * @param helpEntryIndex The help entry index to open.
	 */
	openHelpEntryIndex(helpEntryIndex: number) {
		// Validate the help entry index.
		if (helpEntryIndex < 0 || helpEntryIndex > this._helpEntries.length - 1) {
			this._logService.error(`PositronHelpService help entry index ${helpEntryIndex} is out of range.`);
			return;
		}

		// Set the help entry index and fire the onDidChangeCurrentHelpEntry event.
		this._helpEntryIndex = helpEntryIndex;
		this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[this._helpEntryIndex]);
	}

	/**
	 * Navigates the help service.
	 * @param fromUrl The from URL.
	 * @param toUrl The to URL.
	 */
	navigate(fromUrl: string, toUrl: string) {
		const currentHelpEntry = this._helpEntries[this._helpEntryIndex];
		if (currentHelpEntry && currentHelpEntry.sourceUrl === fromUrl) {
			// Create the target URL.
			const currentTargetUrl = new URL(currentHelpEntry.targetUrl);
			const targetUrl = new URL(toUrl);
			targetUrl.protocol = currentTargetUrl.protocol;
			targetUrl.hostname = currentTargetUrl.hostname;
			targetUrl.port = currentTargetUrl.port;

			// Create the help entry.
			const helpEntry = this._instantiationService.createInstance(HelpEntry,
				this._helpHTML,
				currentHelpEntry.languageId,
				currentHelpEntry.runtimeId,
				currentHelpEntry.languageName,
				toUrl,
				targetUrl.toString()
			);

			// Add the onDidNavigate event handler.
			helpEntry.onDidNavigate(url => {
				this.navigate(helpEntry.sourceUrl, url);
			});

			// Add the help entry.
			this.addHelpEntry(helpEntry);
		}
	}

	/**
	 * Navigates backward.
	 */
	navigateBackward() {
		if (this._helpEntryIndex > 0) {
			this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[--this._helpEntryIndex]);
		}
	}

	/**
	 * Navigates forward.
	 */
	navigateForward() {
		if (this._helpEntryIndex < this._helpEntries.length - 1) {
			this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[++this._helpEntryIndex]);
		}
	}

	//#endregion IPositronHelpService

	//#region Private Methods

	/**
	 * Adds a help entry.
	 * @param helpEntry The help entry to add.
	 */
	private addHelpEntry(helpEntry: HelpEntry) {
		// If the help entry being added matches the current help entry, don't open it again.
		if (this._helpEntries[this._helpEntryIndex]?.sourceUrl === helpEntry.sourceUrl) {
			return;
		}

		// Splice the help entry into the help entries at the current help entry index and trim the
		// remaining help entries to 10.
		const deletedHelpEntries = [
			...this._helpEntries.splice(
				this._helpEntryIndex + 1,
				Infinity,
				helpEntry
			),
			...this._helpEntries.splice(
				0,
				this._helpEntries.length - 10
			)
		];

		// Dispose of the deleted help entries.
		deletedHelpEntries.forEach(deletedHelpEntry => deletedHelpEntry.dispose());

		// Set the new help entry index.
		this._helpEntryIndex = this._helpEntries.length - 1;

		// Raise the onDidChangeCurrentHelpEntry event for the newly added help entry.
		this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[this._helpEntryIndex]);
	}

	/**
	 * Deletes help entries for the specified runtime ID.
	 * @param runtimeId The runtime ID of the help entries to delete.
	 */
	private deleteLanguageRuntimeHelpEntries(runtimeId: string) {
		// Get help entries to delete.
		const helpEntriesToDelete = this._helpEntries.filter(helpEntryToCheck =>
			helpEntryToCheck.runtimeId === runtimeId
		);

		// If there are no help entries to delete, there's nothing more to do.
		if (!helpEntriesToDelete.length) {
			return;
		}

		// Get the current help entry.
		const currentHelpEntry = this._helpEntryIndex === -1 ?
			undefined :
			this._helpEntries[this._helpEntryIndex];

		// Filter out the help entries to delete.
		this._helpEntries = this._helpEntries.filter(helpEntryToCheck =>
			helpEntryToCheck.runtimeId !== runtimeId
		);

		// Update the current help entry, if there was one.
		if (currentHelpEntry) {
			this._helpEntryIndex = currentHelpEntry.runtimeId === runtimeId ?
				-1 :
				this._helpEntries.indexOf(currentHelpEntry);
			this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[this._helpEntryIndex]);
		}

		// Dispose of the deleted help entries.
		helpEntriesToDelete.forEach(deletedHelpEntry => deletedHelpEntry.dispose());

		// Get the set of target origins that we may want to clean up.
		const cleanupTargetOrigins = helpEntriesToDelete.map(helpEntry =>
			new URL(helpEntry.targetUrl).origin
		);

		// Get the set of active target origins so we don't accidentally clean one of them up.
		const activeTargetOrigins = this._helpEntries.map(helpEntry =>
			new URL(helpEntry.targetUrl).origin
		);

		// Stop proxy servers that can be stopped.
		cleanupTargetOrigins.forEach(targetOrigin => {
			if (!activeTargetOrigins.includes(targetOrigin)) {
				this._commandService.executeCommand<boolean>(
					'positronProxy.stopHelpProxyServer',
					targetOrigin
				);
			}
		});
	}

	//#endregion Private Methods
}

// Export the Positron help service identifier.
export const IPositronHelpService = createDecorator<IPositronHelpService>(POSITRON_HELP_SERVICE_ID);

// Register the Positron help service.
registerSingleton(IPositronHelpService, PositronHelpService, InstantiationType.Delayed);
