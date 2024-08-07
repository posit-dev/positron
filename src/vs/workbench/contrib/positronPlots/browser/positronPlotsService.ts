/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronPlotMetadata, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeMessageOutput, LanguageRuntimeSessionMode, RuntimeOutputKind } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
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
import { IDialogService, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { decodeBase64 } from 'vs/base/common/buffer';
import { SavePlotOptions, showSavePlotModalDialog } from 'vs/workbench/contrib/positronPlots/browser/modalDialogs/savePlotModalDialog';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { localize } from 'vs/nls';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { IShowHtmlUriEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { WebviewExtensionDescription } from 'vs/workbench/contrib/webview/browser/webview';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { NotebookOutputPlotClient } from 'vs/workbench/contrib/positronPlots/browser/notebookOutputPlotClient';
import { HtmlPlotClient } from 'vs/workbench/contrib/positronPlots/browser/htmlPlotClient';
import { PreviewHtml } from 'vs/workbench/contrib/positronPreview/browser/previewHtml';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IPositronHoloViewsService } from 'vs/workbench/services/positronHoloViews/common/positronHoloViewsService';
import { PlotSizingPolicyIntrinsic } from 'vs/workbench/services/positronPlots/common/sizingPolicyIntrinsic';

/** The maximum number of recent executions to store. */
const MaxRecentExecutions = 10;

/** The key used to store the preferred history policy */
const HistoryPolicyStorageKey = 'positron.plots.historyPolicy';

/** The key used to store the preferred plot sizing policy */
const SizingPolicyStorageKey = 'positron.plots.sizingPolicy';

/** The key used to store the custom plot size */
const CustomPlotSizeStorageKey = 'positron.plots.customPlotSize';

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

	/** The currently selected history policy. */
	private _selectedHistoryPolicy: HistoryPolicy = HistoryPolicy.Automatic;

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
		@IPositronHoloViewsService private _positronHoloViewsService: IPositronHoloViewsService,
		@IPositronPreviewService private _positronPreviewService: IPositronPreviewService,
		@IFileService private readonly _fileService: IFileService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IClipboardService private _clipboardService: IClipboardService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IExtensionService private readonly _extensionService: IExtensionService) {
		super();

		// Register for language runtime service startups
		this._register(this._runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		// Register for UI comm events
		this._register(this._runtimeSessionService.onDidReceiveRuntimeEvent(event => {
			// If we have a new HTML file to show, turn it into a webview plot.
			if (event.event.name === UiFrontendEvent.ShowHtmlFile) {
				const data = event.event.data as IShowHtmlUriEvent;
				if (data.event.is_plot) {
					this.createWebviewPlot(event.session_id, data);
				}
			}
		}));

		// Listen for plots being selected and update the selected plot ID
		this._register(this._onDidSelectPlot.event((id) => {
			this._selectedPlotId = id;
		}));

		// Listen for plot clients being created by the IPyWidget service and register them with the plots service
		// so they can be displayed in the plots pane.
		this._register(this._positronIPyWidgetsService.onDidCreatePlot((plotClient) => {
			this.registerNewPlotClient(plotClient);
		}));
		// Listen for plot clients from the holoviews service and register them with the plots
		// service so they can be displayed in the plots pane.
		this._register(this._positronHoloViewsService.onDidCreatePlot((plotClient) => {
			this.registerNewPlotClient(plotClient);
		}));

		// When the storage service is about to save state, store the current history policy
		// and storage policy in the workspace storage.
		this._storageService.onWillSaveState(() => {

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
		});

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
		this._sizingPolicies.push(new PlotSizingPolicyIntrinsic());

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
			this._openerService.open(selectedPlot.html.uri,
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
							plotClients.push(new PlotClientInstance(client, metadata));
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
						plotClients.push(new PlotClientInstance(client, metadata));
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
					preferred_size: (event.message.data as any).preferred_size,
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
				const plotClient = new PlotClientInstance(event.client, metadata);
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
		plotClient.onDidClose(() => {
			const index = this._plots.indexOf(plotClient);
			if (index >= 0) {
				this._plots.splice(index, 1);
			}
			// Clear the plot's metadata from storage
			this._storageService.remove(
				this.generateStorageKey(plotClient.metadata.session_id, plotClient.metadata.id),
				StorageScope.WORKSPACE);
		});

		const selectPlot = () => {
			// Raise the Plots pane so the user can see the updated plot
			this._showPlotsPane();

			// Select the plot to bring it into view within the history; it's
			// possible that it is not the most recently created plot
			this._onDidSelectPlot.fire(plotClient.id);
		};

		// Raise the plot if it's updated by the runtime
		plotClient.onDidRenderUpdate((_plot) => {
			selectPlot();
		});

		// Focus the plot if the runtime requests it
		plotClient.onDidShowPlot(() => {
			selectPlot();
		});

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
		// Create a new webview

		const webview = await this._notebookOutputWebviewService.createNotebookOutputWebview(
			runtime, message);
		if (webview) {
			this.registerNewPlotClient(new NotebookOutputPlotClient(webview, message, code));
		}
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
		// It will be automatically removed from the list during onDidClose
		this._plots.forEach((plot, index) => {
			if (plot.id === id) {
				plot.dispose();
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
			plots[0].dispose();
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
							showSavePlotModalDialog(this._layoutService, this._keybindingService, this._dialogService, this._fileService, this._fileDialogService, plot, this.savePlotAs, suggestedPath);
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
		const htmlFileSystemProvider = this._fileService.getProvider(Schemas.file) as HTMLFileSystemProvider;
		const matches = this.getPlotUri(options.uri);

		if (!matches) {
			return;
		}

		const data = matches[2];

		htmlFileSystemProvider.writeFile(options.path, decodeBase64(data).buffer, { create: true, overwrite: true, unlock: true, atomic: false })
			.catch((error: Error) => {
				this._dialogService.error(localize('positronPlotsService.savePlotError.unknown', 'Error saving plot: {0}', error.message));
			});
	};

	private getPlotUri(plotData: string) {
		const regex = /^data:.+\/(.+);base64,(.*)$/;
		const matches = plotData.match(regex);
		if (!matches || matches.length !== 3) {
			return null;
		}
		return matches;
	}

	showSavePlotDialog(uri: string) {
		const matches = this.getPlotUri(uri);

		if (!matches) {
			return;
		}

		const extension = matches[1];

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

	async copyPlotToClipboard(): Promise<void> {
		const plot = this._plots.find(plot => plot.id === this.selectedPlotId);
		if (plot instanceof StaticPlotClient) {
			try {
				await this._clipboardService.writeImage(plot.uri);
			} catch (error) {
				throw new Error(error.message);
			}
		} else if (plot instanceof PlotClientInstance) {
			if (plot.lastRender?.uri) {
				try {
					await this._clipboardService.writeImage(plot.lastRender.uri);
				} catch (error) {
					throw new Error(error.message);
				}
			}
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

	private createWebviewPlot(sessionId: string, event: IShowHtmlUriEvent) {
		// Look up the extension ID
		const session = this._runtimeSessionService.getSession(sessionId);
		const extension = session!.runtimeMetadata.extensionId;
		const webviewExtension: WebviewExtensionDescription = {
			id: extension
		};

		// Create the webview.
		const webview = this._positronPreviewService.createHtmlWebview(sessionId,
			webviewExtension, event) as PreviewHtml;

		// Register the new plot client
		this.registerNewPlotClient(new HtmlPlotClient(webview));

		// Raise the Plots pane so the plot is visible.
		this._showPlotsPane();
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

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}
