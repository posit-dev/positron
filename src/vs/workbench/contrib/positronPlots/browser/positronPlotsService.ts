/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPositronPlotMetadata, PlotClientInstance, PlotClientLocation } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { ILanguageRuntimeMessageOutput, LanguageRuntimeSessionMode, RuntimeOutputKind, UiRuntimeNotifications } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { HTMLFileSystemProvider } from '../../../../platform/files/browser/htmlFileSystemProvider.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createSuggestedFileNameForPlot, DarkFilter, HistoryPolicy, IPositronPlotClient, IPositronPlotsService, PlotRenderFormat, PlotRenderSettings, PlotsDisplayLocation, POSITRON_PLOTS_VIEW_ID, ZoomLevel } from '../../../services/positronPlots/common/positronPlots.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { StaticPlotClient } from '../../../services/positronPlots/common/staticPlotClient.js';
import { IStorageService, StorageTarget, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IPlotSize, IPositronPlotSizingPolicy } from '../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyAuto } from '../../../services/positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicySquare } from '../../../services/positronPlots/common/sizingPolicySquare.js';
import { PlotSizingPolicyFill } from '../../../services/positronPlots/common/sizingPolicyFill.js';
import { PlotSizingPolicyLandscape } from '../../../services/positronPlots/common/sizingPolicyLandscape.js';
import { PlotSizingPolicyPortrait } from '../../../services/positronPlots/common/sizingPolicyPortrait.js';
import { PlotSizingPolicyCustom } from '../../../services/positronPlots/common/sizingPolicyCustom.js';
import { IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IPositronIPyWidgetsService } from '../../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';
import { Schemas } from '../../../../base/common/network.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { decodeBase64 } from '../../../../base/common/buffer.js';
import { SavePlotOptions, showSavePlotModalDialog } from './modalDialogs/savePlotModalDialog.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { localize } from '../../../../nls.js';
import { UiFrontendEvent } from '../../../services/languageRuntime/common/positronUiComm.js';
import { IShowHtmlUriEvent } from '../../../services/languageRuntime/common/languageRuntimeUiClient.js';
import { IPositronPreviewService } from '../../positronPreview/browser/positronPreviewSevice.js';
import { NotebookOutputPlotClient } from './notebookOutputPlotClient.js';
import { HtmlPlotClient } from './htmlPlotClient.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IPositronWebviewPreloadService } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { PlotSizingPolicyIntrinsic } from '../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { WebviewPlotClient } from './webviewPlotClient.js';
import { ACTIVE_GROUP, IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { PositronPlotCommProxy } from '../../../services/languageRuntime/common/positronPlotCommProxy.js';
import { DynamicPlotInstance } from './components/dynamicPlotInstance.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISettableObservable, observableValue } from '../../../../base/common/observable.js';
import { joinPath } from '../../../../base/common/resources.js';
import { PositronPlotRenderQueue } from '../../../services/languageRuntime/common/positronPlotRenderQueue.js';

/** The maximum number of recent executions to store. */
const MaxRecentExecutions = 10;

/** The maximum number of plots with an active webview. */
const MaxActiveWebviewPlots = 5;

/** Time in milliseconds after which webview plots are deactivated if they're not selected. */
const WebviewPlotInactiveTimeout = 120_000;

/** Interval in milliseconds at which inactive webview plots are checked. */
const WebviewPlotInactiveInterval = 1_000;

/** The key used to store the cached plot thumbnail descriptors */
const CachedPlotThumbnailDescriptorsKey = 'positron.plots.cachedPlotThumbnailDescriptors';

/** The key used to store the preferred history policy */
const HistoryPolicyStorageKey = 'positron.plots.historyPolicy';

/** The key used to store the preferred plot sizing policy */
const SizingPolicyStorageKey = 'positron.plots.sizingPolicy';

/** The key used to store the custom plot size */
const CustomPlotSizeStorageKey = 'positron.plots.customPlotSize';

/** The config key used to store the dark mode setting */
const OldDarkFilterModeConfigKey = 'positron.plots.darkFilter';
const DarkFilterModeConfigKey = 'plots.darkFilter';

/** The config key used to store the default plot sizing policy setting */
const DefaultSizingPolicyConfigKey = 'plots.defaultSizingPolicy';

interface DataUri {
	mime: string;
	data: string;
	type: string;
}

/**
 * ICachedPlotThumbnailDescriptor interface.
 */
interface ICachedPlotThumbnailDescriptor {
	readonly plotClientId: string;
	readonly thumbnailURI: string;
}

/**
* PositronPlotsService class.
*/
export class PositronPlotsService extends Disposable implements IPositronPlotsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** The map of cached plot thumbnail descriptors. */
	private readonly _cachedPlotThumbnailDescriptors = new Map<string, ICachedPlotThumbnailDescriptor>();

	/** The list of Positron plots. */
	private readonly _plots: IPositronPlotClient[] = [];

	/** The list of sizing policies. */
	private readonly _sizingPolicies: IPositronPlotSizingPolicy[] = [];

	/** The emitter for the onDidChangeHistoryPolicy event */
	private readonly _onDidChangeHistoryPolicy = new Emitter<HistoryPolicy>();

	/** The emitter for the onDidChangeDarkFilterMode event */
	private readonly _onDidChangeDarkFilterMode = new Emitter<DarkFilter>();

	/** The emitter for the onDidReplacePlots event */
	private readonly _onDidReplacePlots = new Emitter<IPositronPlotClient[]>();

	/** The emitter for the onDidEmitPlot event */
	private readonly _onDidEmitPlot = new Emitter<IPositronPlotClient>();

	/** The emitter for the onDidSelectPlot event */
	private readonly _onDidSelectPlot = new Emitter<string>();

	/** The emitter for the onDidRemovePlot event */
	private readonly _onDidRemovePlot = new Emitter<string>();

	/** The emitter for the onDidChangePlotsRenderSettings event */
	private readonly _onDidChangePlotsRenderSettings = new Emitter<PlotRenderSettings>();

	/** The emitter for the _sizingPolicyEmitter event */
	private readonly _onDidChangeSizingPolicyEmitter = new Emitter<IPositronPlotSizingPolicy>;

	/** The emitter for the onDidChangeDisplayLocation event */
	private readonly _onDidChangeDisplayLocationEmitter = new Emitter<PlotsDisplayLocation>();

	/** The current display location of the plots pane */
	private _displayLocation: PlotsDisplayLocation = PlotsDisplayLocation.MainWindow;

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

	/** The currently selected dark filter mode. */
	private _selectedDarkFilterMode: DarkFilter = DarkFilter.Auto;

	/** Map of the time that a plot was last selected, keyed by the plot client's ID. */
	private _lastSelectedTimeByPlotId = new Map<string, number>();

	private _editorPlots = new Map<string, IPositronPlotClient>();

	/** Map of plot clients, keyed by their plot id as generated by the runtime */
	private _plotClientsByComm = new Map<string, Array<PlotClientInstance>>();

	private _plotCommProxies = new Map<string, PositronPlotCommProxy>();

	/**
	 * A map of render queues, keyed by session ID. Each session has its own render queue
	 * to ensure only one plot render at a time is executed per session.
	 */
	private _renderQueues = new Map<string, PositronPlotRenderQueue>();

	/**
	 * A map of recently executed code; the map is from the parent ID to the
	 * code executed. We keep around the last 10 executions so that when a plot
	 * is emitted, we can generally find the code that generated it and display
	 * it in the plot view.
	 */
	private readonly _recentExecutions = new Map<string, string>();
	private readonly _recentExecutionIds = new Array<string>();

	/** The current plot rendering settings. */
	private readonly _plotsRenderSettings: ISettableObservable<PlotRenderSettings>;

	/** Creates the Positron plots service instance */
	constructor(
		@IClipboardService private _clipboardService: IClipboardService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private _openerService: IOpenerService,
		@IPositronIPyWidgetsService private _positronIPyWidgetsService: IPositronIPyWidgetsService,
		@IPositronNotebookOutputWebviewService private _notebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@IPositronPreviewService private _positronPreviewService: IPositronPreviewService,
		@IPositronWebviewPreloadService private _positronWebviewPreloadService: IPositronWebviewPreloadService,
		@IRuntimeSessionService private _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private _storageService: IStorageService,
		@IViewsService private _viewsService: IViewsService,
	) {
		super();

		// Register for language runtime service startups
		this._register(this._runtimeSessionService.onDidStartRuntime((runtime) => {
			this.attachRuntime(runtime);
		}));

		// Register for session deletions to clean up render queues
		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession((sessionId) => {
			// Remove the render queue for this session
			if (this._renderQueues.has(sessionId)) {
				const renderQueue = this._renderQueues.get(sessionId);
				if (renderQueue) {
					renderQueue.dispose();
				}
				this._renderQueues.delete(sessionId);
			}
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
			const selectedPlot = this._plots.find((plot) => plot.id === id);
			if (selectedPlot instanceof PlotClientInstance) {
				this.setSelectedSizingPolicy(selectedPlot.sizingPolicy);
			}
		}));

		// Listen for plot clients being created by the IPyWidget service and register them with the plots service
		// so they can be displayed in the plots pane.
		this._register(this._positronIPyWidgetsService.onDidCreatePlot((plotClient) => {
			this.registerWebviewPlotClient(plotClient);
		}));
		// Listen for plot clients from the holoviews service and register them with the plots
		// service so they can be displayed in the plots pane.
		this._register(this._positronWebviewPreloadService.onDidCreatePlot((plotClient) => {
			this.registerWebviewPlotClient(plotClient);
		}));

		// When the storage service is about to save state, store policies and cached plot thumbnail descriptors.
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

			// Enumerate the plot clients and update the cached plot thumbnail descriptors.
			const keysToDelete: Set<string> = new Set(this._cachedPlotThumbnailDescriptors.keys());
			this._plots.forEach(plotClient => {
				keysToDelete.delete(plotClient.id);
				if (plotClient instanceof PlotClientInstance) {
					if (plotClient.lastRender?.uri) {
						this._cachedPlotThumbnailDescriptors.set(plotClient.id, {
							plotClientId: plotClient.id,
							thumbnailURI: plotClient.lastRender.uri
						});
					}
				} else if (plotClient instanceof HtmlPlotClient) {
					if (plotClient.thumbnailUri) {
						this._cachedPlotThumbnailDescriptors.set(plotClient.id, {
							plotClientId: plotClient.id,
							thumbnailURI: plotClient.thumbnailUri
						});
					}
				}

				this.storePlotMetadata(plotClient.metadata);
			});

			// Delete any cached plot thumbnail descriptors that are no longer valid.
			keysToDelete.forEach(key => this._cachedPlotThumbnailDescriptors.delete(key));

			// Update the cached plot thumbnail descriptors in workspace storage.
			if (this._cachedPlotThumbnailDescriptors.size) {
				this._storageService.store(
					CachedPlotThumbnailDescriptorsKey,
					JSON.stringify([...this._cachedPlotThumbnailDescriptors.values()]),
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);
			} else {
				this._storageService.store(
					CachedPlotThumbnailDescriptorsKey,
					undefined,
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE);
			}
		}));

		// Listen for changes to the dark mode configuration
		this._selectedDarkFilterMode = this.getDarkFilterSetting();
		this._register(this._configurationService.onDidChangeConfiguration((evt) => {
			if (evt.affectsConfiguration(DarkFilterModeConfigKey) || evt.affectsConfiguration(OldDarkFilterModeConfigKey)) {
				const newMode = this.getDarkFilterSetting();
				if (newMode && newMode !== this.darkFilterMode) {
					this._selectedDarkFilterMode = newMode;
					this._onDidChangeDarkFilterMode.fire(newMode);
				}
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

		// See if there's a preferred history policy in storage, and select it if so
		const preferredHistoryPolicy = this._storageService.get(
			HistoryPolicyStorageKey,
			StorageScope.WORKSPACE);
		if (preferredHistoryPolicy && preferredHistoryPolicy) {
			this._selectedHistoryPolicy = preferredHistoryPolicy as HistoryPolicy;
		}

		// Load the cached plot thumbnail descriptors from workspace storage.
		const cachedPlotThumbnailDescriptorsJSON = this._storageService.get(CachedPlotThumbnailDescriptorsKey, StorageScope.WORKSPACE);
		if (cachedPlotThumbnailDescriptorsJSON) {
			try {
				// Parse the cached plot thumbnail descriptors.
				const cachedPlotThumbnailDescriptors = JSON.parse(cachedPlotThumbnailDescriptorsJSON) as ICachedPlotThumbnailDescriptor[];

				// Initialize the cached plot thumbnail descriptors.
				for (const cachedPlotThumbnailDescriptor of cachedPlotThumbnailDescriptors) {
					this._cachedPlotThumbnailDescriptors.set(cachedPlotThumbnailDescriptor.plotClientId, cachedPlotThumbnailDescriptor);
				}
			} catch (error) {
				this._logService.error(`Error parsing cached plot thumbnail descriptors: ${error}`);
			}
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

		// Initialise current render settings state. These defaults will be changed
		// at the first render of the plots pane.
		this._plotsRenderSettings = observableValue<PlotRenderSettings>('plots-render-settings', {
			size: {
				width: 640,
				height: 400,
			},
			pixel_ratio: 1,
			format: PlotRenderFormat.Png,
		});
		this.onDidChangePlotsRenderSettings = Event.fromObservable(this._plotsRenderSettings);
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
		} else if (selectedPlot instanceof DynamicPlotInstance) {
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
	 * Gets the dark filter setting value, checking both new and old settings.
	 * @returns The dark filter mode
	 */
	private getDarkFilterSetting(): DarkFilter {
		// First check the new setting
		const newValue = this._configurationService.getValue<DarkFilter>(DarkFilterModeConfigKey);
		if (newValue !== undefined) {
			return newValue;
		}

		// Fall back to the old setting
		return this._configurationService.getValue<DarkFilter>(OldDarkFilterModeConfigKey) ?? DarkFilter.Auto;
	}

	get darkFilterMode() {
		return this._selectedDarkFilterMode;
	}

	/**
	 * Gets the current display location.
	 */
	get displayLocation(): PlotsDisplayLocation {
		return this._displayLocation;
	}

	/**
	 * Event fired when the display location changes.
	 */
	readonly onDidChangeDisplayLocation: Event<PlotsDisplayLocation> = this._onDidChangeDisplayLocationEmitter.event;

	/**
	 * Sets the display location of the plots pane.
	 */
	setDisplayLocation(location: PlotsDisplayLocation): void {
		if (this._displayLocation !== location) {
			this._displayLocation = location;
			this._onDidChangeDisplayLocationEmitter.fire(location);
		}
	}

	/**
	 * Gets the default sizing policy as defined in the setting.
	 */
	getDefaultSizingPolicy(): IPositronPlotSizingPolicy {
		const defaultPolicyId = this._configurationService.getValue<string>(DefaultSizingPolicyConfigKey) ?? 'auto';
		const policy = this._sizingPolicies.find(policy => policy.id === defaultPolicyId);
		return policy ?? this._sizingPolicies.find(policy => policy.id === 'auto')!;
	}

	/**
	 * Gets the cached plot thumbnail URI for a given plot ID.
	 * @param plotId The plot ID to get the thumbnail URI for.
	 * @returns The thumbnail URI for the plot, or undefined if not found.
	 */
	getCachedPlotThumbnailURI(plotId: string) {
		return this._cachedPlotThumbnailDescriptors.get(plotId)?.thumbnailURI;
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

		this.setSelectedSizingPolicy(policy);
		const selectedPlot = this._plots.find((plot) => this.selectedPlotId === plot.id);
		if (selectedPlot instanceof PlotClientInstance) {
			selectedPlot.sizingPolicy = policy;
		}
	}

	setEditorSizingPolicy(plotId: string, policyId: string): void {
		const plot = this._editorPlots.get(plotId);
		if (plot instanceof PlotClientInstance) {
			const policy = this._sizingPolicies.find(policy => policy.id === policyId);
			if (policy) {
				plot.sizingPolicy = policy;
			} else {
				this._notificationService.error(localize('positronPlots.sizing.invalidSizingPolicy', 'Invalid sizing policy: {0}', policyId));
			}
		} else {
			this._notificationService.error(localize('positronPlots.sizing.invalidPlotType', 'Cannot set size for this plot type'));
		}
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
	}

	/**
	 * Clears the custom plot size, if one is set. If the custom plot size policy is in use,
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
	 * Selects a new dark filter mode.
	 */
	setDarkFilterMode(mode: DarkFilter): void {
		// Is this the currently selected policy?
		if (this.darkFilterMode === mode) {
			return;
		}

		this._selectedDarkFilterMode = mode;
		this._onDidChangeDarkFilterMode.fire(mode);
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
							// Parse the plot metadata. If the metadata doesn't have a suggested file name, generate one.
							const metadata = JSON.parse(storedMetadata) as IPositronPlotMetadata;
							if (!metadata.suggested_file_name) {
								metadata.suggested_file_name = createSuggestedFileNameForPlot(this._storageService);
							}
							metadata.language = session.runtimeMetadata.languageId;

							if (!metadata.zoom_level) {
								metadata.zoom_level = ZoomLevel.Fit;
							}

							const commProxy = this.createCommProxy(client, metadata);
							plotClients.push(this.createRuntimePlotClient(commProxy, metadata));
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
							location: PlotClientLocation.View,
							suggested_file_name: createSuggestedFileNameForPlot(this._storageService),
							language: session.runtimeMetadata.languageId,
							zoom_level: ZoomLevel.Fit,
						};
						const commProxy = this.createCommProxy(client, metadata);
						plotClients.push(this.createRuntimePlotClient(commProxy, metadata));
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
				// Check if the plot also needs to be restored to an editor tab
				this.restoreEditorPlot(client.metadata.id, session.sessionId, this._plotCommProxies.get(client.metadata.id)!);
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

				const data = event.message.data as any;

				// Create the metadata object
				const metadata: IPositronPlotMetadata = {
					created: Date.parse(event.message.when),
					id: clientId,
					session_id: session.sessionId,
					parent_id: event.message.parent_id,
					code,
					pre_render: data?.pre_render,
					suggested_file_name: createSuggestedFileNameForPlot(this._storageService),
					language: session.runtimeMetadata.languageId,
					zoom_level: ZoomLevel.Fit,
				};

				// Register the plot client
				const commProxy = this.createCommProxy(event.client, metadata);
				const plotClient = this.createRuntimePlotClient(commProxy, metadata);
				this.registerPlotClient(plotClient, true);

				// Raise the Plots pane so the plot is visible.
				this._showPlotsPane();
			}
		}));

		// Configure console-specific behavior.
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			// Listen for static plots being emitted, and register each one with
			// the plots service.
			const handleDidReceiveRuntimeMessageOutput = (message: ILanguageRuntimeMessageOutput) => {
				// Check to see if we we already have a plot client for this
				// message ID. If so, we don't need to do anything.
				if (this.hasPlot(session.sessionId, message.id)) {
					return;
				}

				// Create a plot from the output message.
				const plot = this.createPlot(message, session);
				if (!plot) {
					// If the message does not represent a plot, we don't need to do anything.
					return;
				}

				// If the runtime specified an output ID, update the plot with the given output ID, if one exists.
				if (message.output_id) {
					const existingPlot = this.getPlotForOutput(session.sessionId, message.output_id);
					if (existingPlot) {
						this.replacePlot(existingPlot.id, plot);
						return;
					}
				}

				// This is a new plot, register it with the plots service.
				if (plot instanceof StaticPlotClient) {
					this.registerNewPlotClient(plot);
				} else if (plot instanceof NotebookOutputPlotClient) {
					this.registerWebviewPlotClient(plot);
				}
			};
			this._register(session.onDidReceiveRuntimeMessageOutput(handleDidReceiveRuntimeMessageOutput));
			this._register(session.onDidReceiveRuntimeMessageResult(handleDidReceiveRuntimeMessageOutput));

			this._register(session.onDidReceiveRuntimeMessageUpdateOutput((message) => {
				// Create a plot from the output message.
				const plot = this.createPlot(message, session);
				if (!plot) {
					// If the message does not represent a plot, we don't need to do anything.
					return;
				}

				// Update the plot with the given output ID, if one exists.
				const existingPlot = this.getPlotForOutput(session.sessionId, message.output_id);
				if (existingPlot) {
					this.replacePlot(existingPlot.id, plot);
				}
			}));
		}

		// If this runtime wants plot render settings updates, register handler to
		// send them over via the UI client. This logic should move to an
		// extension-side middleware in the future, see
		// https://github.com/posit-dev/positron/issues/4997.
		if (session.runtimeMetadata.uiSubscriptions?.includes(UiRuntimeNotifications.DidChangePlotsRenderSettings)) {
			this._register(this._runtimeSessionService.watchUiClient(session.sessionId, (uiClient) => {
				// Forward future settings updates. Note that the lifecycle of that event
				// handler is tied to the UI client itself, not to the lifecycle of the session.
				uiClient.register(this.onDidChangePlotsRenderSettings(settings => {
					uiClient.didChangePlotsRenderSettings(settings);
				}));

				// Send initial settings immediately
				uiClient.didChangePlotsRenderSettings(this.getPlotsRenderSettings());
			}));
		}
	}

	/**
	 * Creates a plot from a runtime message output.
	 * @param message The runtime message output to create the plot from.
	 * @param session The language runtime session that the message belongs to.
	 * @returns The plot client instance, or undefined if the message does not represent a plot.
	 */
	private createPlot(message: ILanguageRuntimeMessageOutput, session: ILanguageRuntimeSession): IPositronPlotClient | undefined {
		// Get the code that generated this update.
		const code = this._recentExecutions.get(message.parent_id) ?? '';

		if (message.kind === RuntimeOutputKind.StaticImage) {
			return StaticPlotClient.fromMessage(this._storageService, session.sessionId, message, code);
		} else if (message.kind === RuntimeOutputKind.PlotWidget) {
			return new NotebookOutputPlotClient(this._notebookOutputWebviewService, session, message, code);
		}

		return undefined;
	}

	/**
	 * Check if the stored metadata has a plot for an editor and restore it.
	 */
	private restoreEditorPlot(plotId: string, sessionId: string, commProxy: PositronPlotCommProxy) {
		const metadataKey = this.generateStorageKey(sessionId, plotId, PlotClientLocation.Editor);
		const storedMetadata = this._storageService.get(metadataKey, StorageScope.WORKSPACE);

		if (storedMetadata) {
			try {
				// Parse the plot metadata. If the metadata doesn't have a suggested file name, generate one.
				const metadata = JSON.parse(storedMetadata) as IPositronPlotMetadata;
				if (!metadata.suggested_file_name) {
					metadata.suggested_file_name = createSuggestedFileNameForPlot(this._storageService);
				}

				if (!metadata.zoom_level) {
					metadata.zoom_level = ZoomLevel.Fit;
				}

				this.createEditorPlot(metadata, commProxy);

				this.openEditor(plotId, this.getPreferredEditorGroup(), metadata);
			} catch (error) {
				console.warn(`Error parsing plot metadata: ${error}`);
			}
		}
	}

	private createEditorPlot(metadata: IPositronPlotMetadata, commProxy: PositronPlotCommProxy) {
		const plot = this.createRuntimePlotClient(commProxy, metadata, PlotClientLocation.Editor);
		this._register(plot.onDidClose(() => {
			this._editorPlots.delete(metadata.id);
			this._storageService.remove(
				this.generateStorageKey(metadata.session_id, metadata.id, metadata.location),
				StorageScope.WORKSPACE);
		}));
		this._register(plot.onDidChangeZoomLevel((zoomLevel) => {
			// Update the stored metadata with the new zoom level
			plot.metadata.zoom_level = zoomLevel;
			this.storePlotMetadata(plot.metadata);
		}));
		this._editorPlots.set(metadata.id, plot);
	}

	/**
	 * Save the metadata to storage so that we can restore it when
	 * the plot is reconnected.
	 *
	 * @param metadata the plot metadata
	 */
	private storePlotMetadata(metadata: IPositronPlotMetadata) {
		this._storageService.store(
			this.generateStorageKey(metadata.session_id, metadata.id, metadata.location),
			JSON.stringify(metadata),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE
		);
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

		// Dispose the plot client when this service is disposed (we own this
		// object)
		const disp = this._register(plotClient);

		// Remove the plot from our list when it is closed
		plotClient.register({
			dispose: () => {
				const index = this._plots.indexOf(plotClient);
				if (index >= 0) {
					this._plots.splice(index, 1);
				}

				// Clear the plot's metadata from storage
				this._storageService.remove(
					this.generateStorageKey(plotClient.metadata.session_id, plotClient.metadata.id, plotClient.metadata.location),
					StorageScope.WORKSPACE);

				disp.dispose();
			}
		});

		const selectPlot = () => {
			// Raise the Plots pane so the user can see the updated plot
			this._showPlotsPane();

			// Select the plot to bring it into view within the history; it's
			// possible that it is not the most recently created plot
			this._onDidSelectPlot.fire(plotClient.id);
		};

		// Raise the plot if it's updated by the runtime
		plotClient.register(plotClient.onDidRenderUpdate((_plot) => {
			selectPlot();
		}));

		// Focus the plot if the runtime requests it
		plotClient.register(plotClient.onDidShowPlot(() => {
			selectPlot();
		}));

		plotClient.register(plotClient.onDidChangeSizingPolicy((policy) => {
			this.selectSizingPolicy(policy.id);
		}));
	}

	onDidEmitPlot: Event<IPositronPlotClient> = this._onDidEmitPlot.event;
	onDidSelectPlot: Event<string> = this._onDidSelectPlot.event;
	onDidRemovePlot: Event<string> = this._onDidRemovePlot.event;
	onDidReplacePlots: Event<IPositronPlotClient[]> = this._onDidReplacePlots.event;
	onDidChangeHistoryPolicy: Event<HistoryPolicy> = this._onDidChangeHistoryPolicy.event;
	onDidChangeDarkFilterMode: Event<DarkFilter> = this._onDidChangeDarkFilterMode.event;
	onDidChangePlotsRenderSettings: Event<PlotRenderSettings> = this._onDidChangePlotsRenderSettings.event;
	onDidChangeSizingPolicy: Event<IPositronPlotSizingPolicy> = this._onDidChangeSizingPolicyEmitter.event;

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

	removeEditorPlot(id: string): void {
		const plot = this._editorPlots.get(id);
		if (plot) {
			this.unregisterPlotClient(plot);
			this._editorPlots.delete(id);
		}
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

	/** Gets a plot for a given output identifier. */
	private getPlotForOutput(sessionId: string, outputId: string): IPositronPlotClient | undefined {
		return this._plots.find(plot => plot.metadata.session_id === sessionId && plot.metadata.output_id === outputId);
	}

	/**
	 * Replaces a plot with a new one and fires the appropriate UI events.
	 * @param id The ID of the plot to replace.
	 * @param newPlot The new plot.
	 */
	private replacePlot(id: string, newPlot: IPositronPlotClient) {
		const index = this._plots.findIndex(plot => plot.id === id);
		if (index < 0) {
			throw new Error(`Could not replace unknown plot: ${id}`);
		}

		// Unregister the old plot.
		this.unregisterPlotClient(this._plots[index]);

		// Add the new plot.
		this._register(newPlot);
		this._plots[index] = newPlot;

		// Notify subscribers of the change.
		this._onDidRemovePlot.fire(id);
		this._onDidEmitPlot.fire(newPlot);
		this._onDidSelectPlot.fire(newPlot.id);
		this._showPlotsPane();
	}

	saveViewPlot(): void {
		if (this._selectedPlotId) {
			const plot = this._plots.find(plot => plot.id === this._selectedPlotId);
			this.savePlot(plot);
		}
	}

	saveEditorPlot(plotId: string): void {
		const plot = this._editorPlots.get(plotId);
		this.savePlot(plot);
	}

	private savePlot(plotClient?: IPositronPlotClient) {
		if (!plotClient) {
			this._notificationService.error(localize('positronPlots.noPlotSelected', 'No plot selected.'));
			return;
		}
		this._fileDialogService.defaultFilePath()
			.then(defaultPath => {
				const suggestedPath = defaultPath;
				if (plotClient) {
					if (plotClient instanceof StaticPlotClient) {
						// if it's a static plot, save the image to disk
						const uri = plotClient.uri;
						this.showSavePlotDialog(uri, plotClient.metadata.suggested_file_name);
					} else if (plotClient instanceof PlotClientInstance) {
						// if it's a dynamic plot, present options dialog
						showSavePlotModalDialog(
							this._selectedSizingPolicy,
							plotClient,
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
			type: mime.split('/')[1].split(';')[0],
		};
	}

	showSavePlotDialog(uri: string, suggestedFileName?: string) {
		const dataUri = this.splitPlotDataUri(uri);

		if (!dataUri) {
			return;
		}

		const extension = dataUri.type;

		this._fileDialogService.defaultFilePath().then(defaultPath => {
			const defaultUri = joinPath(defaultPath, suggestedFileName ?? 'plot');
			this._fileDialogService.showSaveDialog({
				title: localize('positron.savePlot', "Save Plot"),
				defaultUri,
				filters:
					[
						{
							name: extension.toUpperCase(),
							extensions: [extension],
						},
					],
			}).then(result => {
				if (result) {
					this.savePlotAs({ path: result, uri });
				}
			});
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
	private generateStorageKey(sessionId: string, plotId: string, location = PlotClientLocation.View): string {
		return `positron.plot.${sessionId}.${plotId}.${location}`;
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
		// Look up the session
		const session = this._runtimeSessionService.getSession(sessionId);

		// Create the plot client.
		const plotClient = new HtmlPlotClient(this._positronPreviewService, this._openerService, session!, event);

		// Register the new plot client
		this.registerWebviewPlotClient(plotClient);

		// Raise the Plots pane so the plot is visible.
		this._showPlotsPane();
	}

	private registerWebviewPlotClient(plotClient: IPositronPlotClient) {
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
	 * Register a new plot client with the service, select it, and fire the
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

	public async openEditor(plotId: string, groupType?: number, metadata?: IPositronPlotMetadata): Promise<void> {
		const plotClient = this._editorPlots.get(plotId) ?? this._plots.find(plot => plot.id === this.selectedPlotId);


		if (!plotClient && !metadata) {
			throw new Error('Cannot open plot in editor: plot not found');
		}

		if (plotClient instanceof WebviewPlotClient) {
			throw new Error('Cannot open plot in editor: webview plot not supported');
		}

		if (plotClient instanceof StaticPlotClient) {
			// Create a copy of the StaticPlotClient for the editor
			const plotCopy = StaticPlotClient.fromMetadata(this._storageService, plotClient.metadata, plotClient.mimeType, plotClient.data);
			this._editorPlots.set(plotClient.id, plotCopy);
			this._register(plotCopy);
		}

		// Create a new plot client instance for the editor
		if (plotClient instanceof PlotClientInstance && plotClient.metadata.location === PlotClientLocation.View) {
			metadata = metadata ?? plotClient.metadata;
			const commProxy = this._plotCommProxies.get(plotId);
			if (commProxy) {
				this.createEditorPlot(metadata, commProxy);
			} else {
				throw new Error('Cannot open plot in editor: plot comm not found');
			}
		}

		const preferredEditorGroup = this.getPreferredEditorGroup();
		const selectedEditorGroup = groupType ?? preferredEditorGroup;
		const editorPane = await this._editorService.openEditor({
			resource: URI.from({
				scheme: Schemas.positronPlotsEditor,
				path: plotId,
			}),
		}, selectedEditorGroup);

		if (!editorPane) {
			throw new Error('Failed to open editor');
		}

		this._storageService.store('positronPlots.defaultEditorAction', selectedEditorGroup, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	public getPreferredEditorGroup(): number {
		const preferredEditorGroup = this._storageService.getNumber('positronPlots.defaultEditorAction', StorageScope.WORKSPACE, ACTIVE_GROUP);
		return preferredEditorGroup;
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

	/**
	 * Creates a new communication proxy for the given client and metadata.
	 *
	 * @param client
	 * @param metadata
	 * @returns A new PositronPlotCommProxy instance.
	 */
	private createCommProxy(
		client: IRuntimeClientInstance<any, any>,
		metadata: IPositronPlotMetadata): PositronPlotCommProxy {

		// Get or create the render queue for this session
		let renderQueue = this._renderQueues.get(metadata.session_id);
		if (!renderQueue) {
			const session = this._runtimeSessionService.getSession(metadata.session_id);
			if (session) {
				renderQueue = new PositronPlotRenderQueue(session, this._logService);
				this._register(renderQueue);
				this._renderQueues.set(metadata.session_id, renderQueue);
			} else {
				this._logService.error(`Cannot find session ${metadata.session_id} for plot ${metadata.id}.`);
				throw new Error(`Cannot find session ${metadata.session_id} for plot ${metadata.id}`);
			}
		}

		const commProxy = new PositronPlotCommProxy(client, renderQueue);
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

	private createRuntimePlotClient(comm: PositronPlotCommProxy, metadata: IPositronPlotMetadata, location: PlotClientLocation = PlotClientLocation.View) {
		// Get the default sizing policy from configuration
		let defaultSizingPolicy = this.getDefaultSizingPolicy();

		// for Python plots, use intrinsic sizing policy as default if configured policy is auto
		if (metadata.language === 'python' && defaultSizingPolicy.id === 'auto') {
			defaultSizingPolicy = this._intrinsicSizingPolicy;
		}

		// Use existing sizing policy if specified, otherwise use the default
		const sizingPolicy =
			this._sizingPolicies.find((policy) => policy.id === metadata.sizing_policy?.id)
			?? defaultSizingPolicy;

		metadata.sizing_policy = {
			id: sizingPolicy.id,
			size: sizingPolicy instanceof PlotSizingPolicyCustom ? sizingPolicy.size : undefined
		};
		const plotClient = new PlotClientInstance(comm, this._configurationService, sizingPolicy ?? this._selectedSizingPolicy, { ...metadata, location: location });
		let plotClients = this._plotClientsByComm.get(metadata.id);

		if (!plotClients) {
			plotClients = [];
			this._plotClientsByComm.set(metadata.id, plotClients);
		}

		plotClients.push(plotClient);

		this.storePlotMetadata({ ...metadata, location });

		return plotClient;
	}

	/**
	 * Gets the current plot rendering settings.
	 */
	public getPlotsRenderSettings(): PlotRenderSettings {
		return this._plotsRenderSettings.get();
	}

	/**
	 * Sets the current plot rendering settings.
	 *
	 * @param settings The new settings.
	 */
	setPlotsRenderSettings(settings: PlotRenderSettings): void {
		// Sanitize values in case sizing policies create floating points
		settings.size.height = Math.floor(settings.size.height);
		settings.size.width = Math.floor(settings.size.width);

		this._plotsRenderSettings.set(settings, undefined);
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}

	private setSelectedSizingPolicy(policy: IPositronPlotSizingPolicy) {
		this._selectedSizingPolicy = policy;
		this._onDidChangeSizingPolicyEmitter.fire(policy);
	}
}

function isActiveWebviewPlot(plot: IPositronPlotClient): plot is WebviewPlotClient {
	return plot instanceof WebviewPlotClient && plot.isActive();
}
