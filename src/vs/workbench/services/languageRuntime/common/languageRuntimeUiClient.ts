/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { BusyEvent, ClearConsoleEvent, UiFrontendEvent, OpenEditorEvent, OpenWorkspaceEvent, PromptStateEvent, ShowMessageEvent, WorkingDirectoryEvent, ShowUrlEvent, SetEditorSelectionsEvent, ShowHtmlFileEvent, HolovizExtensionLoadEvent } from './positronUiComm';
import { PositronUiCommInstance } from 'vs/workbench/services/languageRuntime/common/positronUiCommInstance';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { POSITRON_PREVIEW_PLOTS_IN_VIEWER } from 'vs/workbench/contrib/positronPreview/browser/positronPreview.contribution';


/**
 * The types of messages that can be sent to the backend.
 */
export enum UiMessageTypeInput {
}

/**
 * A message used to send data to the backend.
 */
export interface IUiClientMessageInput {
	msg_type: UiMessageTypeInput;
}

/**
 * The types of messages that can be received from the backend.
 */
export enum UiMessageTypeOutput {
	Event = 'event',
}

/**
 * A message used to deliver data from the backend to the frontend
 */
export interface IUiClientMessageOutput {
	msg_type: UiMessageTypeOutput;
}

/**
 * An event from the backend.
 */
export interface IRuntimeClientEvent {
	name: UiFrontendEvent;
	data: any;
}

/**
 * A message representing an event from the backend
 */
export interface IUiClientMessageOutputEvent
	extends IUiClientMessageOutput, IRuntimeClientEvent {
}


export interface IShowHtmlUriEvent {
	uri: URI;
	event: ShowHtmlFileEvent;
}

/**
 * A UI client instance. This client instance represents the global Positron window, and
 * its lifetime is tied to the lifetime of the Positron window.
 *
 * It is currently used to deliver global events from the backend to the frontend, and to help
 * the backend know when Positron is connected.
 */
export class UiClientInstance extends Disposable {
	private _comm: PositronUiCommInstance;

	/** Emitters for events forwarded from the UI comm */
	onDidBusy: Event<BusyEvent>;
	onDidClearConsole: Event<ClearConsoleEvent>;
	onDidSetEditorSelections: Event<SetEditorSelectionsEvent>;
	onDidOpenEditor: Event<OpenEditorEvent>;
	onDidOpenWorkspace: Event<OpenWorkspaceEvent>;
	onDidShowMessage: Event<ShowMessageEvent>;
	onDidPromptState: Event<PromptStateEvent>;
	onDidWorkingDirectory: Event<WorkingDirectoryEvent>;
	onDidShowUrl: Event<ShowUrlEvent>;
	onDidShowHtmlFile: Event<IShowHtmlUriEvent>;
	onDidHolovizExtensionLoad: Event<HolovizExtensionLoadEvent>;

	/** Emitter wrapper for Show URL events */
	private readonly _onDidShowUrlEmitter = this._register(new Emitter<ShowUrlEvent>());

	/** Emitter wrapper for Show HTML File events */
	private readonly _onDidShowHtmlFileEmitter = this._register(new Emitter<IShowHtmlUriEvent>());

	/**
	 * Creates a new frontend client instance.
	 *
	 * @param _client The client instance. Takes ownership of the client
	 *   instance and will dispose it when it is disposed.
	 */
	constructor(
		private readonly _client: IRuntimeClientInstance<any, any>,
		private readonly _commandService: ICommandService,
		private readonly _logService: ILogService,
		private readonly _openerService: IOpenerService,
		private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._register(this._client);

		this._comm = new PositronUiCommInstance(this._client);
		this.onDidBusy = this._comm.onDidBusy;
		this.onDidClearConsole = this._comm.onDidClearConsole;
		this.onDidSetEditorSelections = this._comm.onDidSetEditorSelections;
		this.onDidOpenEditor = this._comm.onDidOpenEditor;
		this.onDidOpenWorkspace = this._comm.onDidOpenWorkspace;
		this.onDidShowMessage = this._comm.onDidShowMessage;
		this.onDidPromptState = this._comm.onDidPromptState;
		this.onDidWorkingDirectory = this._comm.onDidWorkingDirectory;
		this.onDidShowUrl = this._onDidShowUrlEmitter.event;
		this.onDidShowHtmlFile = this._onDidShowHtmlFileEmitter.event;
		this.onDidHolovizExtensionLoad = this._comm.onDidHolovizExtensionLoad;

		// Wrap the ShowUrl event to resolve incoming external URIs from the
		// backend before broadcasting them to the frontend.
		this._register(this._comm.onDidShowUrl(async e => {
			try {
				let uri = URI.parse(e.url);

				// If this is an HTML file URI, then treat it as a local file to
				// be opened in a browser
				if (uri.scheme === 'file') {
					// Does the URI point to a plain directory (presumably
					// containing an index.html of some kind), or a specific
					// HTML file?  (lowercase to be case-insensitive)
					const uriPath = uri.path.toLowerCase();
					if (uriPath.endsWith('/') ||
						uriPath.endsWith('.html') ||
						uriPath.endsWith('.htm')) {
						this.openHtmlFile(e.url);
					}
					return;
				}

				// Resolve the URI if it is an external URI
				try {
					const resolvedUri = await this._openerService.resolveExternalUri(uri);
					uri = resolvedUri.resolved;
				} catch {
					// Noop; use the original URI
				}
				const resolvedEvent: ShowUrlEvent = {
					url: uri.toString(),
				};
				this._onDidShowUrlEmitter.fire(resolvedEvent);
			} catch {
				this._onDidShowUrlEmitter.fire(e);
			}
		}));

		// Wrap the ShowHtmlFile event to start a proxy server for the HTML file.
		this._register(this._comm.onDidShowHtmlFile(async e => {
			try {
				// Start an HTML proxy server for the file
				const uri = await this.startHtmlProxyServer(e.path);

				if (e.is_plot) {
					// Check the configuration to see if we should open the plot
					// in the Viewer tab. If so, clear the `is_plot` flag so that
					// we open the file in the Viewer.
					const openInViewer = this._configurationService.getValue<boolean>(POSITRON_PREVIEW_PLOTS_IN_VIEWER);
					if (openInViewer) {
						e.is_plot = false;
					}
				}

				const resolvedEvent: IShowHtmlUriEvent = {
					uri,
					event: e,
				};

				this._onDidShowHtmlFileEmitter.fire(resolvedEvent);
			} catch (error) {
				this._logService.error(`Failed to show HTML file ${e.path}: ${error}`);
			}
		}));
	}

	/**
	 * Opens a file URI in an external browser.
	 *
	 * @param url The URL to open in the browser
	 */
	private async openHtmlFile(url: string): Promise<void> {
		// Start an HTML proxy server for the file
		const resolved = await this.startHtmlProxyServer(url);

		// Open the resolved URI in the external browser. (Consider: should
		// _all_ file URIs be opened in the external browser?)
		this._openerService.open(resolved.toString(), {
			openExternal: true,
		});
	}

	/**
	 * Starts an HTML proxy server for the given HTML file.
	 *
	 * @param htmlPath The path to the HTML file to open
	 * @returns A URI representing the HTML file
	 */
	private async startHtmlProxyServer(htmlPath: string): Promise<URI> {
		const url = await this._commandService.executeCommand<string>(
			'positronProxy.startHtmlProxyServer',
			htmlPath
		);

		if (!url) {
			throw new Error('Failed to start HTML file proxy server');
		}

		let uri = URI.parse(url);
		try {
			const resolvedUri = await this._openerService.resolveExternalUri(uri);
			uri = resolvedUri.resolved;
		} catch {
			// Noop; use the original URI
		}

		return uri;
	}
}
