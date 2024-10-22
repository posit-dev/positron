/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPlotMetadata, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeMessageOutput, LanguageRuntimeSessionMode, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { HTMLFileSystemProvider } from 'vs/platform/files/browser/htmlFileSystemProvider';
import { IFileService } from 'vs/platform/files/common/files';
import { HistoryPolicy, IPositronPlotClient, IPositronPlotsService, POSITRON_PLOTS_VIEW_ID } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { Emitter, Event } from 'vs/base/common/event';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';
import { IStorageService, StorageTarget, StorageScope } from 'vs/platform/storage/common/storage';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { IPlotSize, IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import { PlotSizingPolicyAuto } from 'vs/workbench/services/positronPlots/common/sizingPolicyAuto';
import { PlotSizingPolicySquare } from 'vs/workbench/services/positronPlots/common/sizingPolicySquare';
import { PlotSizingPolicyFill } from 'vs/workbench/services/positronPlots/common/sizingPolicyFill';
import { PlotSizingPolicyLandscape } from 'vs/workbench/services/positronPlots/common/sizingPolicyLandscape';
import { PlotSizingPolicyPortrait } from 'vs/workbench/services/positronPlots/common/sizingPolicyPortrait';
import { PlotSizingPolicyCustom } from 'vs/workbench/services/positronPlots/common/sizingPolicyCustom';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IPositronIPyWidgetsService } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { Schemas } from 'vs/base/common/network';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { decodeBase64 } from 'vs/base/common/buffer';
import { SavePlotOptions, showSavePlotModalDialog } from 'vs/workbench/contrib/positronPlots/browser/modalDialogs/savePlotModalDialog';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { localize } from 'vs/nls';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { IShowHtmlUriEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { NotebookOutputPlotClient } from 'vs/workbench/contrib/positronPlots/browser/notebookOutputPlotClient';
import { HtmlPlotClient } from 'vs/workbench/contrib/positronPlots/browser/htmlPlotClient';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IPositronWebviewPreloadService } from 'vs/workbench/services/positronWebviewPreloads/common/positronWebviewPreloadService';
import { PlotSizingPolicyIntrinsic } from 'vs/workbench/services/positronPlots/common/sizingPolicyIntrinsic';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { URI } from 'vs/base/common/uri';
import { PositronPlotCommProxy } from 'vs/workbench/services/languageRuntime/common/positronPlotCommProxy';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';

/** The maximum number of recent executions to store. */
const MaxRecentExecutions = 10;

/** The maximum number of plots with an active webview. */
const MaxActiveWebviewPlots = 5;

/** Time in milliseconds after which webview plots are deactivated if they're not selected. */
const WebviewPlotInactiveTimeout = 120_000;

/** Interval in milliseconds at which inactive webview plots are checked. */
const WebviewPlotInactiveInterval = 1_000;

/** The key used to store the preferred history policy */
const HistoryPolicyStorageKey = 'positron.plots.historyPolicy';

/** The key used to store the preferred plot sizing policy */
const SizingPolicyStorageKey = 'positron.plots.sizingPolicy';

/** The key used to store the custom plot size */
const CustomPlotSizeStorageKey = 'positron.plots.customPlotSize';

interface DataUri {
	mime: string;
	data: string;
	type: string;
}

/**
 * PositronPlotsService class.
 */
export class PositronPlotsService extends Disposable implements IPositronPlotsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** The list of Positron plots. */
	private readonly _plots: IPositronPlotClient[] = [];

	/** The list of sizing policies. */
	private readonly _sizingPolicies: IPositronPlotSizingPolicy[] = [];

	/** The emitter for the onDidChangeSizingPolicy event */
	private readonly _onDidChangeSizingPolicy = new Emitter<IPositronPlotSizingPolicy>();

	/** The emitter for the onDidChangeHistoryPolicy event */
	private readonly _onDidChangeHistoryPolicy = new Emitter<HistoryPolicy>();

	/** The emitter for the onDidReplacePlots event */
	private readonly _onDidReplacePlots = new Emitter<IPositronPlotClient[]>();

	/** The emitter for the onDidEmitPlot event */
	private readonly _onDidEmitPlot = new Emitter<IPositronPlotClient>();

	/** The emitter for the onDidSelectPlot event */
	private readonly _onDidSelectPlot = new Emitter<string>();

	/** The emitter for the onDidRemovePlot event */
	private readonly _onDidRemovePlot = new Emitter<string>();

	/** The ID Of the currently selected plot, if any */
	private _selectedPlotId: string | undefined;

	/** The currently selected sizing policy. */
	private _selectedSizingPolicy: IPositronPlotSizingPolicy;

	/** A custom sizing policy, if we have one. */
	private _customSizingPolicy?: PlotSizingPolicyCustom;

	/** The intrinsic sizing policy. */
	private _intrinsicSizingPolicy: PlotSizingPolicyIntrinsic;

	/** The currently selected history policy. */
	private _selectedHistoryPolicy: HistoryPolicy = HistoryPolicy.Automatic;

	/** Map of the time that a plot was last selected, keyed by the plot client's ID. */
	private _lastSelectedTimeByPlotId = new Map<string, number>();

	private _editorPlots = new Map<string, IPositronPlotClient>();

	/** Map of plot clients, keyed by their plot id as generated by the runtime */
	private _plotClientsByComm = new Map<string, Array<PlotClientInstance>>();

	private _plotCommProxies = new Map<string, PositronPlotCommProxy>();

	/**
	 * A map of recently executed code; the map is from the parent ID to the
	 * code executed. We keep around the last 10 executions so that when a plot
	 * is emitted, we can generally find the code that generated it and display
	 * it in the plot view.
	 */
	private readonly _recentExecutions = new Map<string, string>();
	private readonly _recentExecutionIds = new Array<string>();

	/** Creates the Positron plots service instance */
	constructor(
		@IRuntimeSessionService private _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private _storageService: IStorageService,
		@IViewsService private _viewsService: IViewsService,
		@IOpenerService private _openerService: IOpenerService,
		@IPositronNotebookOutputWebviewService private _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@IPositronIPyWidgetsService private _positronIPyWidgetsService: IPositronIPyWidgetsService,
		@IPositronWebviewPreloadService private _positronWebviewPreloadService: IPositronWebviewPreloadService,
		@IPositronPreviewService private _positronPreviewService: IPositronPreviewService,
		@IFileService private readonly _fileService: IFileService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IClipboardService private _clipboardService: IClipboardService,
		@IPositronModalDialogsService private readonly _modalDialogService: IPositronModalDialogsService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super();

		// Register for language runtime service startups
		this._register(this._runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		// Register for UI comm events
		this._register(this._runtimeSessionService.onDidReceiveRuntimeEvent(async event => {
			// If we have a new HTML file to show, turn it into a webview plot.
			if (event.event.name === UiFrontendEvent.ShowHtmlFile) {
				const data = event.event.data as IShowHtmlUriEvent;
				if (data.event.is_plot) {
					await this.createWebviewPlot(event.session_id, data);
				}
			}
		}));

		// Listen for plots being selected and update the selected plot ID
		this._register(this._onDidSelectPlot.event((id) => {
			this._selectedPlotId = id;
		}));

		// Listen for plot clients being created by the IPyWidget service and register them with the plots service
		// so they can be displayed in the plots pane.
		this._register(this._positronIPyWidgetsService.onDidCreatePlot(async (plotClient) => {
			await this.registerWebviewPlotClient(plotClient);
		}));
		// Listen for plot clients from the holoviews service and register them with the plots
		// service so they can be displayed in the plots pane.
		this._register(this._positronWebviewPreloadService.onDidCreatePlot(async (plotClient) => {
			await this.registerWebviewPlotClient(plotClient);
		}));

		// When the storage service is about to save state, store the current history policy
		// and storage policy in the workspace storage.
		this._register(this._storageService.onWillSaveState(() => {

			this._storageService.store(
				HistoryPolicyStorageKey,
				this._selectedHistoryPolicy,
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE);

			this._storageService.store(
				SizingPolicyStorageKey,
				this._selectedSizingPolicy.id,
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE);

			if (this._customSizingPolicy) {
				// If we have a custom sizing policy, store it in the workspace storage
				this._storageService.store(
					CustomPlotSizeStorageKey,
					JSON.stringify(this._customSizingPolicy.size),
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);
			} else {
				// If we don't, clear the custom plot size from storage
				this._storageService.store(
					CustomPlotSizeStorageKey,
					undefined,
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);
			}
		}));

		// When the extension service is about to stop, remove any HTML plots
		// from the plots list. These plots are backed by a proxy that runs in
		// the extension host, so may become invalid when the extension host is
		// stopped.
		this._register(this._extensionService.onWillStop((e) => {
			// Nothing to do if there are no plots
			if (this._plots.length === 0) {
				return;
			}
			let removedSelectedPlot = false;
			this._plots.forEach((plot, index) => {
				if (plot instanceof HtmlPlotClient) {
					plot.dispose();
					if (this._selectedPlotId === plot.id) {
						removedSelectedPlot = true;
					}
					this._plots.splice(index, 1);
				}
			});

			this._onDidReplacePlots.fire(this._plots);

			// If we removed the selected plot, select the first plot in the list
			if (removedSelectedPlot && this._plots.length > 0) {
				this.selectPlot(this._plots[0].id);
			}
		}));

		// Create the default sizing policy
		this._selectedSizingPolicy = new PlotSizingPolicyAuto();
		this._sizingPolicies.push(this._selectedSizingPolicy);

		// Add some other nifty sizing policies
		this._sizingPolicies.push(new PlotSizingPolicySquare());
		this._sizingPolicies.push(new PlotSizingPolicyLandscape());
		this._sizingPolicies.push(new PlotSizingPolicyPortrait());
		this._sizingPolicies.push(new PlotSizingPolicyFill());
		this._intrinsicSizingPolicy = new PlotSizingPolicyIntrinsic();
		this._sizingPolicies.push(this._intrinsicSizingPolicy);

		// See if there's a custom size policy in storage, and retrieve it if so
		const customSizingPolicy = this._storageService.get(
			CustomPlotSizeStorageKey,
			StorageScope.WORKSPACE);
		if (customSizingPolicy) {
			try {
				// Parse the custom size policy and create a new custom sizing policy
				const size = JSON.parse(customSizingPolicy) as IPlotSize;
				this._customSizingPolicy = new PlotSizingPolicyCustom(size);
				this._sizingPolicies.push(this._customSizingPolicy);
			} catch (error) {
				console.warn(`Error parsing custom plot size: ${error}`);
			}
		}

		// See if there's a preferred sizing policy in storage, and select it if so
		const preferredSizingPolicyId = this._storageService.get(
			SizingPolicyStorageKey,
			StorageScope.WORKSPACE);
		if (preferredSizingPolicyId) {
			const policy = this._sizingPolicies.find(
				policy => policy.id === preferredSizingPolicyId);
			if (policy) {
				this._selectedSizingPolicy = policy;
			}
		}

		// See if there's a preferred history policy in storage, and select it if so
		const preferredHistoryPolicy = this._storageService.get(
			HistoryPolicyStorageKey,
			StorageScope.WORKSPACE);
		if (preferredHistoryPolicy && preferredHistoryPolicy) {
			this._selectedHistoryPolicy = preferredHistoryPolicy as HistoryPolicy;
		}

		// When a plot is selected, update its last selected time.
		this._register(this._onDidSelectPlot.event(async (id) => {
			this._lastSelectedTimeByPlotId.set(id, Date.now());
		}));

		// Start an interval that checks for inactive webview plots and deactivates them.
		this._register(DOM.disposableWindowInterval(
			DOM.getActiveWindow(),
			() => {
				// Update the last selected time for the current selected plot.
				const now = Date.now();
				if (this._selectedPlotId) {
					this._lastSelectedTimeByPlotId.set(this._selectedPlotId, now);
				}

				// Get the active webview plots.
				const activeWebviewPlots = this._plots.filter(isActiveWebviewPlot);

				// Deactivate webview plots that have not been selected for a while.
				for (const plotClient of activeWebviewPlots) {
					const selectedTime = this._lastSelectedTimeByPlotId.get(plotClient.id);
					if (selectedTime && selectedTime + WebviewPlotInactiveTimeout < now) {
						this._logService.debug(
							`Deactivating plot '${plotClient.id}'; last selected ` +
							`${WebviewPlotInactiveTimeout / 1000} seconds ago`,
						);
						plotClient.deactivate();
					}
				}
			}, WebviewPlotInactiveInterval));
	}

	private _showPlotsPane() {
		this._viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);
	}

	openPlotInNewWindow(): void {

		if (!this._selectedPlotId) {
			throw new Error('Cannot open plot in new window: no plot selected');
		}

		const selectedPlot = this._plots.find(plot => plot.id === this._selectedPlotId);
		if (!selectedPlot) {
			throw new Error(`Cannot open plot in new window: plot ${this._selectedPlotId} not found`);
		}

		if (selectedPlot instanceof HtmlPlotClient) {
			this._openerService.open(selectedPlot.uri,
				{ openExternal: true, fromUserGesture: true });
		} else {
			throw new Error(`Cannot open plot in new window: plot ${this._selectedPlotId} is not an HTML plot`);
		}
	}

	/**
	 * Gets the currently known sizing policies.
	 */
	get sizingPolicies() {
		return this._sizingPolicies;
	}

	/**
	 * Gets the currently selected sizing policy.
	 */
	get selectedSizingPolicy() {
		return this._selectedSizingPolicy;
	}

	/**
	 * Gets the current history policy.
	 */
	get historyPolicy() {
		return this._selectedHistoryPolicy;
	}

	/**
	 * Selects a new sizing policy and fires an event indicating that the policy
	 * has changed.
	 *
	 * @param id The sizing policy ID to select.
	 */
	selectSizingPolicy(id: string): void {
		// Is this the currently selected policy?
		if (this.selectedSizingPolicy.id === id) {
			return;
		}

		// Find the policy with the given ID
		const policy = this._sizingPolicies.find(policy => policy.id === id);
		if (!policy) {
			throw new Error(`Invalid sizing policy ID: ${id}`);
		}
		this._selectedSizingPolicy = policy;
		this._onDidChangeSizingPolicy.fire(policy);
	}

	/**
	 * Sets a custom plot size and applies it as a custom sizing policy.
	 *
	 * @param size The new custom plot size.
	 */
	setCustomPlotSize(size: IPlotSize): void {
		// See if we already have a custom sizing policy; if we do, remove it so
		// we can add a new one (currently we only support one custom sizing
		// policy at a time)
		if (this._customSizingPolicy) {
			this._sizingPolicies.splice(this._sizingPolicies.indexOf(this._customSizingPolicy), 1);
		}

		// Create and apply the new custom sizing policy
		const policy = new PlotSizingPolicyCustom(size);
		this._sizingPolicies.push(policy);
		this._selectedSizingPolicy = policy;
		this._customSizingPolicy = policy;
		this._onDidChangeSizingPolicy.fire(policy);
	}

	/**
	 * Clears the custom plot size, if one is set. If the custom plot size policy is in used,
	 * switch to the automatic sizing policy.
	 */
	clearCustomPlotSize(): void {
		// Check to see whether the custom sizing policy is currently in use
		const currentPolicy = this._customSizingPolicy === this._selectedSizingPolicy;

		if (this._customSizingPolicy) {
			// If there's a custom sizing policy, remove it from the list of
			// sizing policies.
			this._sizingPolicies.splice(this._sizingPolicies.indexOf(this._customSizingPolicy), 1);
			this._customSizingPolicy = undefined;

			// If the custom sizing policy was in use, switch to the automatic
			// sizing policy.
			if (currentPolicy) {
				this._selectedSizingPolicy = new PlotSizingPolicyAuto();
				this._onDidChangeSizingPolicy.fire(this._selectedSizingPolicy);
			}
		}
	}

	/**
	 * Selects a new history policy and fires an event indicating that the policy
	 * has changed.
	 */
	selectHistoryPolicy(policy: HistoryPolicy): void {
		// Is this the currently selected policy?
		if (this.historyPolicy === policy) {
			return;
		}

		this._selectedHistoryPolicy = policy;
		this._onDidChangeHistoryPolicy.fire(policy);
	}

	/**
	 * Attaches to a language runtime session.
	 *
	 * @param session The language session to attach to.
	 */
	private attachRuntime(session: ILanguageRuntimeSession) {
		// Get the list of existing plot clients; these are expected in the
		// case of reconnecting to a running language runtime, and represent
		// the user's active set of plot objects.
		session.listClients(RuntimeClientType.Plot).then(clients => {
			const plotClients: Array<PlotClientInstance> = [];
			clients.forEach((client) => {
				if (client.getClientType() === RuntimeClientType.Plot) {
					// Check to see if we we already have a plot client for this
					// client ID. If so, we don't need to do anything.
					if (this.hasPlot(session.runtimeMetadata.runtimeId, client.getClientId())) {
						return;
					}

					// Attempt to load the metadata for this plot from storage
					const storedMetadata = this._storageService.get(
						this.generateStorageKey(session.sessionId, client.getClientId()),
						StorageScope.WORKSPACE);

					// If we have metadata, try to parse it and register the plot
					let registered = false;
					if (storedMetadata) {
						try {
							const metadata = JSON.parse(storedMetadata) as IPositronPlotMetadata;
							const commProxy = this.createCommProxy(client, metadata);
							plotClients.push(this.createRuntimePlotClient(commProxy));
							registered = true;
						} catch (error) {
							console.warn(`Error parsing plot metadata: ${error}`);
						}
					}
					// If we don't have metadata, register the plot with a default metadata object
					if (!registered) {
						const metadata: IPositronPlotMetadata = {
							created: Date.now(),
							id: client.getClientId(),
							session_id: session.sessionId,
							parent_id: '',
							code: '',
						};
						const commProxy = this.createCommProxy(client, metadata);
						plotClients.push(this.createRuntimePlotClient(commProxy));
					}
				} else {
					console.warn(
						`Unexpected client type ${client.getClientType()} ` +
						`(expected ${RuntimeClientType.Plot})`);
				}
			});

			// If we have no plot clients, we're done
			if (plotClients.length === 0) {
				return;
			}

			// Before we start registering plots, take note of whether we have
			// any plots already registered.
			const wasEmpty = this._plots.length === 0;

			// Register each plot client with the plots service, but don't fire the
			// events.
			plotClients.forEach((client) => {
				this.registerPlotClient(client, false);
			});

			// Re-sort the plots by creation time since we may have added new ones that are
			// out of order.
			this._plots.sort((a, b) => a.metadata.created - b.metadata.created);

			// Fire the onDidReplacePlots event
			this._onDidReplacePlots.fire(this._plots);

			// If we had no plots before, select the first one
			if (wasEmpty && this._plots.length > 0) {
				this.selectPlot(this._plots[0].id);
			}
		});

		this._register(session.onDidReceiveRuntimeMessageInput((message) => {
			// Add this code to the recent executions map. If the map is
			// already at the maximum size, remove the oldest entry.
			this._recentExecutionIds.push(message.parent_id);
			if (this._recentExecutionIds.length > MaxRecentExecutions) {
				const id = this._recentExecutionIds.shift();
				if (id) {
					this._recentExecutions.delete(id);
				}
			}
			this._recentExecutions.set(message.parent_id, message.code);
		}));

		// Listen for new dynamic plots being emitted, and register each one
		// with the plots service.
		this._register(session.onDidCreateClientInstance((event) => {
			if (event.client.getClientType() === RuntimeClientType.Plot) {
				const clientId = event.client.getClientId();

				// Check to see if we we already have a plot client for this
				// client ID. If so, we don't need to do anything.
				if (this.hasPlot(session.sessionId, clientId)) {
					return;
				}

				// Get the code that generated this plot, if we have it
				const code = this._recentExecutions.has(event.message.parent_id) ?
					this._recentExecutions.get(event.message.parent_id)! : '';

				// Create the metadata object
				const metadata: IPositronPlotMetadata = {
					created: Date.parse(event.message.when),
					id: clientId,
					session_id: session.sessionId,
					parent_id: event.message.parent_id,
					code,
				};

				// Save the metadata to storage so that we can restore it when
				// the plot is reconnected.
				this._storageService.store(
					this.generateStorageKey(metadata.session_id, metadata.id),
					JSON.stringify(metadata),
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);

				// Register the plot client
				const commProxy = this.createCommProxy(event.client, metadata);
				const plotClient = this.createRuntimePlotClient(commProxy);
				this.registerPlotClient(plotClient, true);

				// Raise the Plots pane so the plot is visible.
				this._showPlotsPane();
			}
		}));

		// Configure console-specific behavior.
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			// Listen for static plots being emitted, and register each one with
			// the plots service.
			const handleDidReceiveRuntimeMessageOutput = async (message: ILanguageRuntimeMessageOutput) => {
				// Check to see if we we already have a plot client for this
				// message ID. If so, we don't need to do anything.
				if (this.hasPlot(session.sessionId, message.id)) {
					return;
				}

				const code = this._recentExecutions.has(message.parent_id) ?
					this._recentExecutions.get(message.parent_id) : '';
				if (message.kind === RuntimeOutputKind.StaticImage) {
					// Create a new static plot client instance and register it with the service.
					this.registerStaticPlot(session.sessionId, message, code);

					// Raise the Plots pane so the plot is visible.
					this._showPlotsPane();
				} else if (message.kind === RuntimeOutputKind.PlotWidget) {
					// Create a new webview plot client instance and register it with the service.
					await this.registerNotebookOutputPlot(session, message, code);

					// Raise the Plots pane so the plot is visible.
					this._showPlotsPane();
				}
			};
			this._register(session.onDidReceiveRuntimeMessageOutput(handleDidReceiveRuntimeMessageOutput));
			this._register(session.onDidReceiveRuntimeMessageResult(handleDidReceiveRuntimeMessageOutput));
		}
	}

	/**
	 * Creates a new plot client instance wrapper and registers it with the
	 * service.
	 *
	 * @param plotClient The plot client instance to wrap.
	 * @param fireEvents Whether to fire events for this plot client.
	 */
	private registerPlotClient(plotClient: PlotClientInstance, fireEvents: boolean) {

		// Add to our list of plots
		this._plots.push(plotClient);

		// Fire events for this plot if requested
		if (fireEvents) {
			this._onDidEmitPlot.fire(plotClient);
			this._onDidSelectPlot.fire(plotClient.id);
		}

		// Remove the plot from our list when it is closed
		this._register(plotClient.onDidClose(() => {
			this.unregisterPlotClient(plotClient);
			const index = this._plots.indexOf(plotClient);
			if (index >= 0) {
				this._plots.splice(index, 1);
			}
			// Clear the plot's metadata from storage
			this._storageService.remove(
				this.generateStorageKey(plotClient.metadata.session_id, plotClient.metadata.id),
				StorageScope.WORKSPACE);
		}));

		const selectPlot = () => {
			// Raise the Plots pane so the user can see the updated plot
			this._showPlotsPane();

			// Select the plot to bring it into view within the history; it's
			// possible that it is not the most recently created plot
			this._onDidSelectPlot.fire(plotClient.id);
		};

		// Raise the plot if it's updated by the runtime
		this._register(plotClient.onDidRenderUpdate((_plot) => {
			selectPlot();
		}));

		// Focus the plot if the runtime requests it
		this._register(plotClient.onDidShowPlot(() => {
			selectPlot();
		}));

		// Dispose the plot client when this service is disposed (we own this
		// object)
		this._register(plotClient);
	}

	/**
	 * Creates a new static plot client instance and registers it with the
	 * service.
	 *
	 * @param message The message containing the static plot data.
	 * @param code The code that generated the plot, if available.
	 */
	private registerStaticPlot(
		sessionId: string,
		message: ILanguageRuntimeMessageOutput,
		code?: string) {
		this.registerNewPlotClient(new StaticPlotClient(sessionId, message, code));
	}

	/**
	 * Creates a new webview plot client instance and registers it with the
	 * service.
	 *
	 * @param message The message containing the source for the webview.
	 * @param code The code that generated the plot, if available.
	 */
	private async registerNotebookOutputPlot(
		runtime: ILanguageRuntimeSession,
		message: ILanguageRuntimeMessageOutput,
		code?: string) {
		const plotClient = new NotebookOutputPlotClient(
			this._notebookOutputWebviewService, runtime, message, code
		);
		await this.registerWebviewPlotClient(plotClient);
	}

	onDidEmitPlot: Event<IPositronPlotClient> = this._onDidEmitPlot.event;
	onDidSelectPlot: Event<string> = this._onDidSelectPlot.event;
	onDidRemovePlot: Event<string> = this._onDidRemovePlot.event;
	onDidReplacePlots: Event<IPositronPlotClient[]> = this._onDidReplacePlots.event;
	onDidChangeSizingPolicy: Event<IPositronPlotSizingPolicy> = this._onDidChangeSizingPolicy.event;
	onDidChangeHistoryPolicy: Event<HistoryPolicy> = this._onDidChangeHistoryPolicy.event;

	// Gets the individual plot instances.
	get positronPlotInstances(): IPositronPlotClient[] {
		return this._plots;
	}

	// Gets the ID of the currently selected plot.
	get selectedPlotId(): string | undefined {
		return this._selectedPlotId;
	}

	/**
	 * Select a plot by ID
	 *
	 * @param index The ID of the plot to select.
	 */
	selectPlot(id: string): void {
		this._onDidSelectPlot.fire(id);
	}

	/**
	 * Selects the next plot in the list, if there is one.
	 */
	selectNextPlot(): void {
		// Get the index of the currently selected plot
		const index = this._plots.findIndex(plot => plot.id === this._selectedPlotId);

		// If we found a plot and it's not the last one in the list, select the
		// next plot.
		if (index >= 0 && index < (this._plots.length - 1)) {
			this._onDidSelectPlot.fire(this._plots[index + 1].id);
		}
	}

	/**
	 * Selects the previous plot in the list, if there is one.
	 */
	selectPreviousPlot(): void {
		// Get the index of the currently selected plot
		const index = this._plots.findIndex(plot => plot.id === this._selectedPlotId);

		// If we found a plot and it's not the first one in the list, select the
		// previous plot.
		if (index > 0) {
			this._onDidSelectPlot.fire(this._plots[index - 1].id);
		}
	}

	/**
	 * Remove a plot by ID
	 *
	 * @param id The ID of the plot to remove
	 */
	removePlot(id: string): void {
		// Find the plot with the given ID and dispose it
		this._plots.forEach((plot, index) => {
			if (plot.id === id) {
				this.unregisterPlotClient(plot);
				this._plots.splice(index, 1);
			}
		});

		// If this plot was selected, select the first plot in the list
		if (this._selectedPlotId === id) {
			if (this._plots.length > 0) {
				// There are still some plots; select the first one
				this._onDidSelectPlot.fire(this._plots[0].id);
			}
			else {
				// There are no plots; clear the selected plot ID
				this._selectedPlotId = undefined;
			}
		}

		// Fire the event notifying subscribers
		this._onDidRemovePlot.fire(id);
	}

	/**
	 * Removes the currently selected plot from the service and fires an event
	 * to update the the UI
	 */
	removeSelectedPlot(): void {
		if (this._selectedPlotId) {
			this.removePlot(this._selectedPlotId);
		} else {
			throw new Error('No plot is selected');
		}
	}

	/**
	 * Removes all the plots from the service and fires an event to
	 * update the the UI
	 */
	removeAllPlots(): void {
		// Dispose each plot in the set
		const count = this._plots.length;
		for (let i = count - 1; i >= 0; i--) {
			const plots = this._plots.splice(i, 1);
			this.unregisterPlotClient(plots[0]);
		}

		// Update the front end with the now-empty array of plots
		this._onDidSelectPlot.fire('');
		this._onDidReplacePlots.fire(this._plots);
	}

	savePlot(): void {
		if (this._selectedPlotId) {
			const plot = this._plots.find(plot => plot.id === this._selectedPlotId);
			this._fileDialogService.defaultFilePath()
				.then(defaultPath => {
					const suggestedPath = defaultPath;
					if (plot) {
						let uri = '';

						if (plot instanceof StaticPlotClient) {
							// if it's a static plot, save the image to disk
							uri = plot.uri;
							this.showSavePlotDialog(uri);
						} else if (plot instanceof PlotClientInstance) {
							// if it's a dynamic plot, present options dialog
							showSavePlotModalDialog(
								this._selectedSizingPolicy,
								this._layoutService,
								this._keybindingService,
								this._modalDialogService,
								this._fileService,
								this._fileDialogService,
								this._logService,
								this._notificationService,
								plot,
								this.savePlotAs,
								suggestedPath
							);
						} else {
							// if it's a webview plot, do nothing
							return;
						}
					}
				})
				.catch((error) => {
					throw new Error(`Error saving plot: ${error.message}`);
				});
		}
	}

	private savePlotAs = (options: SavePlotOptions) => {
		const htmlFileSystemProvider = this._fileService.getProvider(options.path.scheme) as HTMLFileSystemProvider;
		const dataUri = this.splitPlotDataUri(options.uri);

		if (!dataUri) {
			return;
		}

		const data = dataUri.data;

		htmlFileSystemProvider.writeFile(options.path, decodeBase64(data).buffer, { create: true, overwrite: true, unlock: true, atomic: false })
			.catch((error: Error) => {
				this._notificationService.error(localize('positronPlotsService.savePlotError.unknown', 'Error saving plot: {0}', error.message));
			});
	};

	/**
	 * Splits an image data URI into its MIME, type, and data.
	 * @param plotDataUri the data URI
	 * @returns the `DataUri`.
	 */
	private splitPlotDataUri(plotDataUri: string): DataUri | null {
		// match the data URI scheme
		// the data portion isn't matched because of javascript regex performance with large stringszs
		const mimeAndData = plotDataUri.split('base64,');
		if (mimeAndData.length !== 2) {
			return null;
		}

		const mime = mimeAndData[0].split('data:')[1];
		const imageData = mimeAndData[1];

		return {
			mime: mime,
			data: imageData,
			type: mime.split('/')[1]
		};
	}

	showSavePlotDialog(uri: string) {
		const dataUri = this.splitPlotDataUri(uri);

		if (!dataUri) {
			return;
		}

		const extension = dataUri.type;

		this._fileDialogService.showSaveDialog({
			title: 'Save Plot',
			filters:
				[
					{
						extensions: [extension],
						name: extension.toUpperCase(),
					},
				],
		}).then(result => {
			if (result) {
				this.savePlotAs({ path: result, uri });
			}
		});
	}

	private async copyPlotToClipboard(plotClient: IPositronPlotClient): Promise<void> {
		let plotUri = undefined;
		if (plotClient instanceof StaticPlotClient) {
			plotUri = plotClient.uri;
		} else if (plotClient instanceof PlotClientInstance) {
			plotUri = plotClient.lastRender?.uri;
		}
		if (plotUri) {
			try {
				await this._clipboardService.writeImage(plotUri);
			} catch (error) {
				throw new Error(error.message);
			}
		} else {
			throw new Error('Plot not found');
		}
	}

	async copyViewPlotToClipboard(): Promise<void> {
		const plotClient = this._plots.find(plot => plot.id === this.selectedPlotId);
		if (plotClient) {
			this.copyPlotToClipboard(plotClient);
		} else {
			throw new Error('Plot not found');
		}
	}

	async copyEditorPlotToClipboard(plotId: string): Promise<void> {
		const plotClient = this._editorPlots.get(plotId);
		if (plotClient) {
			this.copyPlotToClipboard(plotClient);
		} else {
			throw new Error('Plot not found');
		}

	}

	/**
	 * Generates a storage key for a plot.
	 *
	 * @param runtimeId The ID of the runtime that owns the plot.
	 * @param plotId The ID of the plot itself.
	 */
	private generateStorageKey(sessionId: string, plotId: string): string {
		return `positron.plot.${sessionId}.${plotId}`;
	}

	/**
	 * Checks to see whether the service has a plot with the given ID.
	 *
	 * @param sessionId The session ID that generated the plot.
	 * @param plotId The plot's unique ID.
	 */
	private hasPlot(sessionId: string, plotId: string): boolean {
		return this._plots.some(plot =>
			plot.metadata.session_id === sessionId &&
			plot.metadata.id === plotId);
	}

	private async createWebviewPlot(sessionId: string, event: IShowHtmlUriEvent) {
		// Look up the session
		const session = this._runtimeSessionService.getSession(sessionId);

		// Create the plot client.
		const plotClient = new HtmlPlotClient(this._positronPreviewService, this._openerService, session!, event);

		// Register the new plot client
		await this.registerWebviewPlotClient(plotClient);

		// Raise the Plots pane so the plot is visible.
		this._showPlotsPane();
	}

	private async registerWebviewPlotClient(plotClient: IPositronPlotClient) {
		if (plotClient instanceof WebviewPlotClient) {
			// Ensure that the number of active webview plots does not exceed the maximum.
			this._register(plotClient.onDidActivate(() => {
				// Get the active webview plots.
				const activeWebviewPlots = this._plots.filter(isActiveWebviewPlot);

				// If we haven't exceeded the threshold, do nothing.
				if (activeWebviewPlots.length <= MaxActiveWebviewPlots) {
					return;
				}

				// Get plot IDs sorted by last selected time.
				const sortedPlotIds = Array.from(this._lastSelectedTimeByPlotId.entries())
					.sort((a, b) => a[1] - b[1])
					.map(([plotId,]) => plotId);

				// Find the oldest awake webview plot and hibernate it.
				for (const plotId of sortedPlotIds) {
					const plotClient = activeWebviewPlots.find(plot => plot.id === plotId);
					if (plotClient) {
						this._logService.debug(
							`Deactivating plot '${plotId}'; ` +
							`maximum number of active webview plots reached`
						);
						plotClient.deactivate();
						break;
					}
				}
			}));
		}

		this.registerNewPlotClient(plotClient);
	}

	/**
	 * Registser a new plot client with the service, select it, and fire the
	 * appropriate events.
	 *
	 * @param client The plot client to register
	 */
	private registerNewPlotClient(client: IPositronPlotClient) {
		this._plots.unshift(client);
		this._onDidEmitPlot.fire(client);
		this._onDidSelectPlot.fire(client.id);
		this._register(client);
		this._showPlotsPane();
	}

	public async openEditor(): Promise<void> {
		const plotClient = this._plots.find(plot => plot.id === this.selectedPlotId);

		if (plotClient instanceof WebviewPlotClient) {
			throw new Error('Cannot open plot in editor: webview plot not supported');
		}

		let plotId: string | undefined;
		if (plotClient instanceof StaticPlotClient) {
			plotId = plotClient.id;
			this._editorPlots.set(plotClient.id, plotClient);
		}
		if (plotClient instanceof PlotClientInstance) {
			plotId = plotClient.id;
			const commProxy = this._plotCommProxies.get(plotId);
			if (commProxy) {
				const editorPlotClient = this.createRuntimePlotClient(commProxy);
				this._editorPlots.set(editorPlotClient.id, editorPlotClient);
			} else {
				throw new Error('Cannot open plot in editor: plot comm not found');
			}
		}

		if (!plotId) {
			throw new Error('Cannot open plot in editor: plot not found');
		}

		const editorPane = await this._editorService.openEditor({
			resource: URI.from({
				scheme: Schemas.positronPlotsEditor,
				path: plotId,
			}),
		});

		if (!editorPane) {
			throw new Error('Failed to open editor');
		}
	}

	public getEditorInstance(id: string) {
		return this._editorPlots.get(id);
	}

	public unregisterPlotClient(plotClient: IPositronPlotClient) {
		if (plotClient instanceof PlotClientInstance) {
			const plotId = plotClient.id;
			const plotClients = this._plotClientsByComm.get(plotId);
			if (plotClients) {
				const indexToRemove = plotClients.indexOf(plotClient);
				if (indexToRemove >= 0) {
					plotClients.splice(indexToRemove, 1);
				}
				// If, after removing client, the comm's client list is now empty, clean it up.
				if (plotClients.length === 0) {
					const commProxy = this._plotCommProxies.get(plotId);
					commProxy?.dispose();
					this._plotCommProxies.delete(plotId);
					this._plotClientsByComm.delete(plotId);
				}
			}
		}

		plotClient.dispose();
	}

	private createCommProxy(client: IRuntimeClientInstance<any, any>, metadata: IPositronPlotMetadata) {
		const commProxy = new PositronPlotCommProxy(client, metadata);
		this._plotCommProxies.set(metadata.id, commProxy);

		this._register(commProxy.onDidClose(() => {
			const plotClients = this._plotClientsByComm.get(metadata.id);
			if (plotClients) {
				plotClients.forEach(plotClient => {
					plotClient.dispose();
				});
			}
			this._plotClientsByComm.delete(metadata.id);
		}));

		this._register(commProxy);

		return commProxy;
	}

	private createRuntimePlotClient(comm: PositronPlotCommProxy) {
		const plotClient = new PlotClientInstance(comm, comm.metadata);
		let plotClients = this._plotClientsByComm.get(comm.metadata.id);

		if (!plotClients) {
			plotClients = [];
			this._plotClientsByComm.set(comm.metadata.id, plotClients);
		}

		plotClients.push(plotClient);

		return plotClient;
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}

function isActiveWebviewPlot(plot: IPositronPlotClient): plot is WebviewPlotClient {
	return plot instanceof WebviewPlotClient && plot.isActive();
}
