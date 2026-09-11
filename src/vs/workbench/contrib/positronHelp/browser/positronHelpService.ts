/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { AppResourcePath, FileAccess } from '../../../../base/common/network.js';
import { join } from '../../../../base/common/path.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { isLocalhost, tryParseUrl } from './utils.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService, OpenExternalOptions } from '../../../../platform/opener/common/opener.js';
import { WebviewThemeDataProvider } from '../../webview/browser/themeing.js';
import { HelpEntry, IHelpEntry } from './helpEntry.js';
import { ShowHelpEvent } from '../../../services/languageRuntime/common/positronHelpComm.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { HelpClientInstance } from '../../../services/languageRuntime/common/languageRuntimeHelpClient.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronDocsService } from '../../../services/positronDocs/browser/positronDocsService.js';

/**
 * The help HTML file path.
 */
const HELP_HTML_FILE_PATH = 'vs/workbench/contrib/positronHelp/browser/resources/help.html';

/**
 * The welcome page HTML file path.
 */
const WELCOME_HTML_FILE_PATH = 'vs/workbench/contrib/positronHelp/browser/resources/welcome.html';

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
	 * Ask an active runtime to show help for the given topic.
	 *
	 * @param languageId The language ID. A runtime for this language must be active.
	 * @param topic The help topic.
	 * @returns A boolean indicating whether help was found for the requested topic.
	 */
	showHelpTopic(languageId: string, topic: string): Promise<boolean>;

	/**
	 * Navigates the help service.
	 * @param fromHelpEntry The help entry the navigation came from.
	 * @param toTargetUrl The target URL to navigate to.
	 */
	navigate(fromHelpEntry: IHelpEntry, toTargetUrl: string): void;

	/**
	 * Navigates backward.
	 */
	navigateBackward(): void;

	/**
	 * Navigates forward.
	 */
	navigateForward(): void;

	/**
	 * Show the find widget.
	 */
	find(): void;

	/**
	 * Show the welcome page.
	 */
	showWelcomePage(): void;
}

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {
	//#region Private Properties

	/**
	 * Gets or sets the help HTML.
	 */
	private _helpHTML = '<!DOCTYPE html><html><body></body></html>';

	/**
	 * Gets or sets the welcome HTML.
	 */
	private _welcomeHTML = '<!DOCTYPE html><html><body></body></html>';

	/**
	 * Gets or sets the help entries.
	 */
	private _helpEntries: HelpEntry[] = [];

	/**
	 * Gets or sets the help entry index.
	 */
	private _helpEntryIndex = -1;

	/**
	 * Gets the help clients. Keyed by the runtime session ID.
	 */
	private readonly _helpClients = new Map<string, HelpClientInstance>();

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
	 * @param _logService The ILogService.
	 * @param _notificationService The INotificationService.
	 * @param _openerService The IOpenerService.
	 * @param _runtimeSessionService The IRuntimeSessionService.
	 * @param _themeService The IThemeService.
	 * @param _viewsService The IViewsService.
	 */
	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IThemeService private readonly _themeService: IThemeService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IPositronDocsService private readonly _docsService: IPositronDocsService,

	) {
		// Call the base class's constructor.
		super();

		// Load the help HTML file.
		this._fileService.readFile(FileAccess.asFileUri(HELP_HTML_FILE_PATH))
			.then(fileContent => {
				// Set the help HTML to the file's contents.
				this._helpHTML = fileContent.value.toString();
			}).catch(error => {
				// Set the help HTML to an error message. This will be
				// displayed in the Help pane.
				this._helpHTML = notFoundHelper(error, HELP_HTML_FILE_PATH);
			});

		// Load the welcome HTML file.
		this._fileService.readFile(FileAccess.asFileUri(WELCOME_HTML_FILE_PATH))
			.then(async fileContent => {
				let html = fileContent.value.toString();

				await Promise.all([
					['vs/workbench/browser/media/positron-header.svg', '__logoSrcLight__'],
					['vs/workbench/browser/media/positron-header-dark.svg', '__logoSrcDark__'],
				].map(async ([filePath, placeholder]) => {
					// Set the help HTML to the file's contents.
					const wordmarkContent = await this._fileService.readFile(FileAccess.asFileUri(filePath as AppResourcePath));

					// Convert SVG buffer to base64 encoded data URL
					const base64Svg = btoa(wordmarkContent.value.toString());
					const dataUrl = `data:image/svg+xml;base64,${base64Svg}`;

					html = html
						.replace(placeholder, dataUrl);
				}));

				// Replace Positron docs URL with configured value or default
				html = html.replace('__positronDocsUrl__', this._docsService.baseUrl);

				this._welcomeHTML = html;
				this.showWelcomePage();
			}).catch(error => {
				// Set the help HTML to an error message. This will be
				// displayed in the Help pane.
				this._welcomeHTML = notFoundHelper(error, WELCOME_HTML_FILE_PATH);
			});

		// Register onDidColorThemeChange handler.
		this._register(this._themeService.onDidColorThemeChange(async _colorTheme => {
			// Set the proxy server styles when the color theme changes.
			await this.setProxyServerStyles();
		}));

		// Register onDidReceiveRuntimeEvent handler.
		this._register(
			this._runtimeSessionService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
				if (languageRuntimeStateEvent.new_state === RuntimeState.Ready) {
					this.attachRuntime(languageRuntimeStateEvent.session_id);
				}
			})
		);
	}

	/**
	 * Requests that the given help topic be shown in the Help pane.
	 *
	 * @param languageId The language ID. A runtime for this language must be active.
	 * @param topic The help topic.
	 * @returns A boolean indicating whether help was found for the requested topic.
	 */
	showHelpTopic(languageId: string, topic: string): Promise<boolean> {
		const clients = this._helpClients.values();
		for (const client of clients) {
			if (client.languageId === languageId) {
				return client.showHelpTopic(topic);
			}
		}
		this._logService.warn(`Can't show help for ${topic}: ` +
			`no runtime for language ${languageId} is active.`);
		return Promise.resolve(false);
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
	 * @param fromHelpEntry The help entry the navigation came from.
	 * @param toTargetUrl The target URL to navigate to.
	 */
	navigate(fromHelpEntry: IHelpEntry, toTargetUrl: string) {
		// Ignore navigations from anything but the current help entry. A hidden
		// help entry's webview can still be alive and posting messages.
		const currentHelpEntry = this._helpEntries[this._helpEntryIndex];
		if (currentHelpEntry !== fromHelpEntry) {
			return;
		}

		// Create and add the help entry.
		this.addHelpEntry(this.createHelpEntry(
			this._helpHTML,
			currentHelpEntry.languageId,
			currentHelpEntry.sessionId,
			currentHelpEntry.languageName,
			toTargetUrl
		));
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

	/**
	 * Show the find widget.
	 */
	find() {
		this.currentHelpEntry.showFind();
	}

	//#endregion IPositronHelpService

	//#region Private Methods

	/**
	 * Sets the proxy server styles.
	 */
	private async setProxyServerStyles() {
		// Create a webview theme data provider. It's a convenient way to get the styles we need for
		// the help proxy server.
		const webviewThemeDataProvider = this._instantiationService.createInstance(
			WebviewThemeDataProvider
		);

		// Push the styles to the proxy server. A failure here leaves the help
		// topic unthemed, which isn't reason enough to fail the navigation, so
		// the error is logged and swallowed rather than propagated.
		try {
			const { styles } = webviewThemeDataProvider.getWebviewThemeData();
			await this._commandService.executeCommand(
				'positronProxy.setHelpProxyServerStyles',
				styles
			);
		} catch (error) {
			this._logService.error('PositronHelpService could not set the proxy server styles');
			this._logService.error(error);
		} finally {
			webviewThemeDataProvider.dispose();
		}
	}

	/**
	 * Resolves a help entry's target URL to the source URL its webview loads.
	 *
	 * Help topics reach the webview through a help proxy server that runs in
	 * the extension host. Those servers don't survive an extension host
	 * restart, so nothing is remembered here: a help entry calls this every
	 * time it loads and gets back an origin that is live right now. Asking
	 * every time is no more expensive than caching would be, because the
	 * PositronProxy hands back the existing proxy server for a target origin
	 * when there is one.
	 *
	 * @param targetUrl The target URL.
	 * @returns The source URL to load, or undefined if it could not be resolved.
	 */
	async resolveSourceUrl(targetUrl: string): Promise<string | undefined> {
		// Help entries that a runtime's help server doesn't serve - the welcome
		// page, for one - are loaded as they are.
		const targetUrlObject = tryParseUrl(targetUrl);
		if (!targetUrlObject || !isLocalhost(targetUrlObject.hostname)) {
			return targetUrl;
		}

		// Push the current styles to the proxy. A proxy server started after an
		// extension host restart has never been styled, so this can't be done
		// once per window.
		await this.setProxyServerStyles();

		// Ask the PositronProxy for the proxy server origin serving the target
		// origin, starting a server if one isn't running yet.
		let proxyServerOrigin: string | undefined;
		try {
			proxyServerOrigin = await this._commandService.executeCommand<string>(
				'positronProxy.startHelpProxyServer',
				targetUrlObject.origin
			);
		} catch (error) {
			this._logService.error(`PositronHelpService could not start the proxy server for ${targetUrlObject.origin}.`);
			this._logService.error(error);
		}

		// If the help proxy server could not be started, notify the user.
		if (!proxyServerOrigin) {
			this._notificationService.error(localize(
				'positronHelpServiceUnavailable',
				"The Positron help service is unavailable."
			));
			return undefined;
		}

		// Create the source URL.
		const sourceUrl = new URL(targetUrlObject);
		const proxyServerOriginUrl = new URL(proxyServerOrigin);
		sourceUrl.protocol = proxyServerOriginUrl.protocol;
		sourceUrl.hostname = proxyServerOriginUrl.hostname;
		sourceUrl.port = proxyServerOriginUrl.port;
		sourceUrl.pathname = join(proxyServerOriginUrl.pathname, targetUrlObject.pathname);

		return sourceUrl.toString();
	}

	/**
	 * Creates a help entry.
	 * @param helpHTML The help HTML.
	 * @param languageId The language ID.
	 * @param sessionId The runtime session ID.
	 * @param languageName The language name.
	 * @param targetUrl The target URL.
	 * @returns The help entry.
	 */
	private createHelpEntry(
		helpHTML: string,
		languageId: string,
		sessionId: string,
		languageName: string,
		targetUrl: string
	) {
		// Create the help entry. The entry resolves the source URL it loads
		// through the service, every time it loads; see resolveSourceUrl.
		const helpEntry = this._instantiationService.createInstance(HelpEntry,
			helpHTML,
			languageId,
			sessionId,
			languageName,
			targetUrl,
			target => this.resolveSourceUrl(target)
		);

		// Add the navigation event handlers. The emitters behind these events
		// belong to the help entry, so the listeners go away when it does.
		helpEntry.onDidNavigate(toTargetUrl => this.navigate(helpEntry, toTargetUrl));
		helpEntry.onDidNavigateBackward(() => this.navigateBackward());
		helpEntry.onDidNavigateForward(() => this.navigateForward());

		return helpEntry;
	}

	/**
	 * Adds a help entry.
	 * @param helpEntry The help entry to add.
	 */
	private addHelpEntry(helpEntry: HelpEntry) {
		// If the help entry being added matches the current help entry, don't open it again.
		// Help entries are identified by their target URL: the source URL they
		// load from isn't resolved until the entry loads, and it changes when
		// the extension host restarts.
		if (this._helpEntries[this._helpEntryIndex]?.targetUrl === helpEntry.targetUrl) {
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
	 * Deletes help entries for the specified runtime session ID.
	 *
	 * @param sessionId The session ID of the help entries to delete.
	 */
	private deleteLanguageRuntimeHelpEntries(sessionId: string) {
		// Get help entries to delete.
		const helpEntriesToDelete = this._helpEntries.filter(helpEntryToCheck =>
			helpEntryToCheck.sessionId === sessionId
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
			helpEntryToCheck.sessionId !== sessionId
		);

		// Update the current help entry, if there was one.
		if (currentHelpEntry) {
			this._helpEntryIndex = currentHelpEntry.sessionId === sessionId ?
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
					'positronProxy.stopProxyServer',
					targetOrigin
				);
			}
		});
	}

	/**
	 * Attaches a runtime to the Help service by opening a client connection to it.
	 *
	 * @param runtimeId The runtime ID.
	 */
	async attachRuntime(sessionId: string) {
		// Look up the runtime in the runtime service.
		const session = this._runtimeSessionService.getSession(sessionId);
		if (!session) {
			this._logService.error(`PositronHelpService could not attach to session ${sessionId}.`);
			return;
		}
		try {
			// Check for an existing help client.
			const existingClients = await session.listClients(RuntimeClientType.Help);

			// It'd be surprising if we had more than one of these clients, since we
			// try to only make one of them, so log a warning if we do.
			if (existingClients.length > 1) {
				const clientIds = existingClients.map(client => client.getClientId()).join(', ');
				this._logService.warn(
					`Session ${session.dynState.sessionName} has multiple help clients: ` +
					`${clientIds}`);
			}

			// Use an existing client if there is one; otherwise, create a new one.
			const client = existingClients.length > 0 ?
				existingClients[0] :
				await session.createClient(RuntimeClientType.Help, {});

			// Create and attach the help client wrapper.
			const helpClient = new HelpClientInstance(client, session.runtimeMetadata.languageId);
			this.attachClientInstance(session, helpClient);

		} catch (error) {
			this._logService.error(
				`PositronHelpService could not create client for session ${sessionId}: ` +
				`${error}`);
		}
	}

	/**
	 * Attaches a client instance to the Help service.
	 *
	 * @param session The language runtime session.
	 * @param client The help client instance.
	 */
	attachClientInstance(session: ILanguageRuntimeSession, client: HelpClientInstance) {
		const sessionId = session.sessionId;

		// Shouldn't happen.
		if (this._helpClients.has(sessionId)) {
			this._logService.warn(`
			PositronHelpService already has a client for session ${sessionId}; ` +
				`it will be replaced.`);
			const oldClient = this._helpClients.get(sessionId);
			if (oldClient) {
				oldClient.dispose();
			}
		}

		// Save our connection to the client.
		this._register(client);
		this._helpClients.set(sessionId, client);

		// When the client emits help content, show it in the Help pane.
		this._register(client.onDidEmitHelpContent(helpContent => {
			this.handleShowHelpEvent(session, helpContent);
		}));

		// When the client closes, delete the help entries for the runtime.
		this._register(client.onDidClose(() => {
			this.deleteLanguageRuntimeHelpEntries(sessionId);
			this._helpClients.delete(sessionId);
		}));
	}

	showWelcomePage() {
		// Add the help entry. The welcome page is bundled rather than served by
		// a runtime's help server, so its target URL is loaded as-is.
		this.addHelpEntry(this.createHelpEntry(this._welcomeHTML, '', '', '', 'welcome.html'));
	}

	private async handleShowHelpEvent(
		session: ILanguageRuntimeSession,
		showHelpEvent: ShowHelpEvent) {

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

		// Basically this can't happen.
		if (!session) {
			this._notificationService.error(localize(
				'positronHelpServiceInternalError',
				"The Positron help service experienced an unexpected error."
			));
			return;
		}

		// Open the help view.
		await this._viewsService.openView(POSITRON_HELP_VIEW_ID, false);

		// Create the help entry. The help entry resolves the proxied source URL
		// it loads from on its own, when it loads; see resolveSourceUrl.
		const helpEntry = this.createHelpEntry(
			this._helpHTML,
			session.runtimeMetadata.languageId,
			session.runtimeMetadata.runtimeId,
			session.runtimeMetadata.languageName,
			targetUrl.toString()
		);

		// Add the help entry.
		this.addHelpEntry(helpEntry);

		// Raise the onDidFocusHelp event, if we should.
		if (showHelpEvent.focus) {
			this._onDidFocusHelpEmitter.fire();
		}
	}

	//#endregion Private Methods
}

/**
 * Format HTML string that contains an error message when a file could not be read.
 * @param error Error returned when reading file.
 * @param path Path to the file that could not be read.
 * @returns HTML string that contains an error message.
 */
const notFoundHelper = (error: any, path: string) => `<!DOCTYPE html><html><body><h1>Error Loading Help</h1><p>Cannot read ${path}:</p><p>${error}</body></html>`;


// Export the Positron help service identifier.
export const IPositronHelpService = createDecorator<IPositronHelpService>(POSITRON_HELP_SERVICE_ID);

// Register the Positron help service.
registerSingleton(IPositronHelpService, PositronHelpService, InstantiationType.Delayed);
