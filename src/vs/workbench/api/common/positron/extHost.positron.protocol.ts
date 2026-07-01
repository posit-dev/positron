/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IHostedLanguageContribution, ILanguageRuntimeInfo, ILanguageRuntimeMetadata, IRuntimeRootSignature, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, ILanguageRuntimeMessage, ILanguageRuntimeExit, RuntimeExitReason, LanguageRuntimeSessionMode, ILanguageRuntimeResourceUsage, ILanguageRuntimeLaunchInfo } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { createProxyIdentifier, IRPCProtocol, SerializableObjectWithBuffers } from '../../../services/extensions/common/proxyIdentifier.js';
import { MainContext, IWebviewPortMapping, WebviewExtensionDescription, IChatProgressDto, ExtHostQuickOpenShape } from '../extHost.protocol.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IEditorContext } from '../../../services/frontendMethods/common/editorContext.js';
import { RuntimeClientType, LanguageRuntimeSessionChannel } from './extHostTypes.positron.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { INotebookContextDTO, NotebookCellType } from '../../../common/positron/notebookAssistant.js';
import { ActiveRuntimeSessionMetadata, EnvironmentVariableAction, LanguageRuntimeDynState, LanguageRuntimePackage, PackageSpec, RuntimeMissingPackage, RuntimeMissingPackagesTarget, RuntimeSessionMetadata, type notebooks } from 'positron';
import { IDriverMetadata, Input } from '../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { IAvailableDriverMethods } from '../../browser/positron/mainThreadConnections.js';
import { IChatRequestData, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { DataConnectionParameterValuesDTO, IDataConnectionCodeVariantDTO, IDataConnectionDriverMetadataDTO, IDataConnectionDriverSummaryDTO, IDataConnectionNodeDTO } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { IDataExplorerRpcDto, IDataExplorerResponseDto, IDataExplorerUiEventDto } from '../../../services/positronDataExplorer/common/dataExplorerRpcTransport.js';
import { IChatAgentData } from '../../../contrib/chat/common/participants/chatAgents.js';
import { PlotRenderSettings } from '../../../services/positronPlots/common/positronPlots.js';
import { QueryTableSummaryResult, Variable } from '../../../services/languageRuntime/common/positronVariablesComm.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { IPositronChatProvider } from '../../../contrib/chat/common/languageModels.js';
import { ICodeLocation } from '../../../services/positronConsole/common/codeLocation.js';
import { EvalResult } from '../../../services/languageRuntime/common/positronUiComm.js';

// NOTE: This check is really to ensure that extHost.protocol is included by the TypeScript compiler
// as a dependency of this module, and therefore that it's initialized first. This is to avoid a
// race condition where VSCode and Positron proxy identifiers are created in a different order in
// the main process vs the extension host process breaking interprocess RPC calls.
if (Object.values(MainContext)[0].nid !== 1) {
	console.error('MainContext was initialized out of order!');
}

/**
 * The initial state returned when starting or resuming a runtime session.
 */
export interface RuntimeInitialState {
	handle: number;
	dynState: LanguageRuntimeDynState;
}


/**
 * An item contributed to the runtime picker.
 */
export interface IRuntimePickerItem {
	id: string;
	label: string;
	detail?: string;
	separatorLabel?: string;
}

// This is the interface that the main process exposes to the extension host
export interface MainThreadLanguageRuntimeShape extends IDisposable {
	$registerLanguageRuntime(metadata: ILanguageRuntimeMetadata): void;
	$selectLanguageRuntime(runtimeId: string): Promise<void>;
	$startLanguageRuntime(runtimeId: string, sessionName: string, sessionMode: LanguageRuntimeSessionMode, notebookUri: URI | undefined): Promise<string>;
	$completeLanguageRuntimeDiscovery(): void;
	$unregisterLanguageRuntime(runtimeId: string): void;
	$executeCode(languageId: string, extensionId: string, sessionId: string | undefined, code: string, focus: boolean, allowIncomplete?: boolean, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior, executionId?: string, documentUri?: URI, executionMetadata?: Record<string, unknown>): Promise<string>;
	$executeInlineCells(extensionId: string, documentUri: URI, cellRanges: IRange[], executionMetadata?: Record<string, unknown>[]): Promise<void>;
	$getPreferredRuntime(languageId: string): Promise<ILanguageRuntimeMetadata | undefined>;
	$getRegisteredRuntimes(): Promise<ILanguageRuntimeMetadata[]>;
	$getActiveSessions(): Promise<ActiveRuntimeSessionMetadata[]>;
	$getSession(sessionId: string): Promise<ActiveRuntimeSessionMetadata | undefined>;
	$getForegroundSession(): Promise<ActiveRuntimeSessionMetadata | undefined>;
	$getNotebookSession(notebookUri: URI): Promise<ActiveRuntimeSessionMetadata | undefined>;
	$restartSession(sessionId: string): Promise<boolean>;
	$interruptSession(sessionId: string): Promise<void>;
	$focusSession(sessionId: string): void;
	$deleteSession(sessionId: string): Promise<boolean>;
	$shutdownSession(sessionId: string, exitReason: RuntimeExitReason): Promise<void>;
	$executeInSession(sessionId: string, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior, executionMetadata?: Record<string, unknown>): Promise<void>;
	$getSessionDynState(sessionId: string): Promise<LanguageRuntimeDynState>;
	$getSessionWorkingDirectory(sessionId?: string): Promise<string | undefined>;
	$getSessionVariables(sessionId: string, accessKeys?: Array<Array<string>>): Promise<Array<Array<Variable>>>;
	$querySessionTables(sessionId: string, accessKeys: Array<Array<string>>, queryTypes: Array<string>): Promise<Array<QueryTableSummaryResult>>;
	$callMethod(sessionId: string, method: string, args: unknown[]): Thenable<unknown>;
	$emitPerfMark(extensionId: string, name: string): void;
	$emitLanguageRuntimeMessage(sessionId: string, handled: boolean, message: SerializableObjectWithBuffers<ILanguageRuntimeMessage>): void;
	$emitLanguageRuntimeState(sessionId: string, clock: number, state: RuntimeState): void;
	$emitLanguageRuntimeExit(sessionId: string, exit: ILanguageRuntimeExit): void;
	$emitLanguageRuntimeResourceUsage(sessionId: string, usage: ILanguageRuntimeResourceUsage): void;
	$evaluateCode(languageId: string, sessionId: string | undefined, code: string, evaluationId: string): Promise<EvalResult>;
	$cancelEvaluation(sessionId: string, evaluationId: string): void;
	$registerRuntimePickerContribution(handle: number, languageId: string): void;
	$unregisterRuntimePickerContribution(handle: number): void;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostLanguageRuntimeShape {
	$isHostForLanguageRuntime(runtimeMetadata: ILanguageRuntimeMetadata): Promise<boolean>;
	$createLanguageRuntimeSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata, sessionName: string): Promise<RuntimeInitialState>;
	$restoreLanguageRuntimeSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata, sessionName: string): Promise<RuntimeInitialState>;
	$validateLanguageRuntimeMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata>;
	$validateLanguageRuntimeSession(metadata: ILanguageRuntimeMetadata, sessionId: string): Promise<boolean>;
	$disposeLanguageRuntime(handle: number): Promise<void>;
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$openResource(handle: number, resource: URI | string): Promise<boolean>;
	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior, codeLocation?: ICodeLocation, executionId?: string, executionMetadata?: Record<string, unknown>): void;
	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus>;
	$createClient(handle: number, id: string, type: RuntimeClientType, params: unknown, metadata?: unknown): Promise<void>;
	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>>;
	$removeClient(handle: number, id: string): void;
	$sendClientMessage(handle: number, client_id: string, message_id: string, message: unknown): void;
	$replyToPrompt(handle: number, id: string, response: string): void;
	$setWorkingDirectory(handle: number, directory: string): Promise<void>;
	$interruptLanguageRuntime(handle: number): Promise<void>;
	$restartSession(handle: number, workingDirectory?: string): Promise<void>;
	$callMethod(handle: number, method: string, args: unknown[]): Thenable<unknown>;
	$shutdownLanguageRuntime(handle: number, exitReason: RuntimeExitReason): Promise<void>;
	$forceQuitLanguageRuntime(handle: number): Promise<void>;
	$showOutputLanguageRuntime(handle: number, channel?: LanguageRuntimeSessionChannel): void;
	$listOutputChannelsLanguageRuntime(handle: number): Promise<LanguageRuntimeSessionChannel[]>;
	$updateSessionNameLanguageRuntime(handle: number, sessionName: string): void;
	$showProfileLanguageRuntime(handle: number): void;
	$getLaunchInfo(handle: number): Promise<ILanguageRuntimeLaunchInfo | undefined>;
	$discoverLanguageRuntimes(disabledLanguageIds: string[], skipLanguageIds?: string[]): void;
	$markRuntimeDiscoveryComplete(): void;
	$recommendWorkspaceRuntimes(disabledLanguageIds: string[]): Promise<ILanguageRuntimeMetadata[]>;
	$getDiscoveryRootSignature(extensionId: string, languageId: string): Promise<IRuntimeRootSignature | undefined>;
	$getHostedLanguageContributions(): Promise<IHostedLanguageContribution[]>;
	$onDidRegisterLanguageRuntime(metadata: ILanguageRuntimeMetadata): void;
	$notifyForegroundSessionChanged(sessionId: string | undefined): void;
	$notifyCodeExecuted(event: ILanguageRuntimeCodeExecutedEvent): void;
	$getPackages(handle: number, token: CancellationToken): Promise<LanguageRuntimePackage[]>;
	$installPackages(handle: number, packages: PackageSpec[], token: CancellationToken): Promise<void>;
	$uninstallPackages(handle: number, packageNames: string[], token: CancellationToken): Promise<void>;
	$updatePackages(handle: number, packages: PackageSpec[], token: CancellationToken): Promise<void>;
	$updateAllPackages(handle: number, token: CancellationToken): Promise<void>;
	$searchPackages(handle: number, query: string, token: CancellationToken): Promise<LanguageRuntimePackage[]>;
	$searchPackageVersions(handle: number, name: string, token: CancellationToken): Promise<string[]>;
	$getPackageMetadata(handle: number, packageNames: string[], token: CancellationToken): Promise<Record<string, Partial<LanguageRuntimePackage>> | undefined>;
	$listMissingPackages(handle: number, target: RuntimeMissingPackagesTarget, token: CancellationToken): Promise<RuntimeMissingPackage[]>;
	$getPackageDetail(handle: number, name: string, token: CancellationToken): Promise<Partial<LanguageRuntimePackage> | undefined>;
	$getRuntimePickerItems(handle: number): Promise<IRuntimePickerItem[]>;
	$handleRuntimePickerSelection(handle: number, itemId: string): Promise<string | undefined>;
}

// This is the interface that the main process exposes to the extension host
export interface MainThreadModalDialogsShape extends IDisposable {
	$showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Promise<boolean>;
	$showSimpleModalDialogMessage(title: string, message: string, okButtonTitle?: string): Promise<null>;
	$showSimpleModalDialogInput(title: string, message: string, defaultValue?: string, placeholder?: string, timeout?: number): Promise<string | null>;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostModalDialogsShape { }

// Interface that the main process exposes to the extension host
export interface MainThreadContextKeyServiceShape {
	$evaluateWhenClause(whenClause: string): Promise<boolean>;
}

// Interface to the main thread exposed by the extension host
export interface ExtHostContextKeyServiceShape { }

export interface MainThreadConsoleServiceShape {
	$getConsoleWidth(): Promise<number>;
	$getSessionIdForLanguage(languageId: string): Promise<string | undefined>;
	$tryPasteText(sessionId: string, text: string): void;
}

export interface ExtHostConsoleServiceShape {
	$onDidChangeConsoleWidth(newWidth: number): void;
	$addConsole(sessionId: string): void;
	$removeConsole(sessionId: string): void;
}

export interface MainThreadMethodsShape { }

export interface ExtHostMethodsShape {
	lastActiveEditorContext(): Promise<IEditorContext | null>;
	showDialog(title: string, message: string): Promise<null>;
	showQuestion(title: string, message: string, okButtonTitle: string, cancelButtonTitle: string): Promise<boolean>;
}

export interface MainThreadConnectionsShape {
	$registerConnectionDriver(driverId: string, metadata: IDriverMetadata, availableMethods: IAvailableDriverMethods): void;
	$removeConnectionDriver(driverId: string): void;
}

export interface ExtHostConnectionsShape {
	$driverGenerateCode(driverId: string, inputs: Input[]): Promise<string | { code: string; errorMessage: string }>;
	$driverConnect(driverId: string, code: string): Promise<void>;
	$driverCheckDependencies(driverId: string): Promise<boolean>;
	$driverInstallDependencies(driverId: string): Promise<boolean>;
}

/**
 * Main thread side of the data connections RPC channel. The ext host calls
 * these methods to register/unregister drivers with the main thread service.
 */
export interface MainThreadDataConnectionsShape extends IDisposable {
	/**
	 * Called by the ext host when an extension registers a data connection driver.
	 * Wraps the driver in an adapter and registers it with the service.
	 * @param driverId The unique identifier for the driver.
	 * @param metadata Serializable driver info (name, parameters, supported languages, etc.).
	 */
	$registerDataConnectionDriver(driverId: string, metadata: IDataConnectionDriverMetadataDTO): void;

	/**
	 * Called by the ext host when a driver is unregistered (its Disposable was disposed).
	 * @param driverId The unique identifier for the driver to remove.
	 */
	$removeDataConnectionDriver(driverId: string): void;

	/**
	 * Returns summaries of all registered data connection drivers.
	 */
	$getDataConnectionDrivers(): Promise<IDataConnectionDriverSummaryDTO[]>;

	/**
	 * Connects to a driver and returns a connection handle. The main thread
	 * adapter calls back into the ext host via $driverConnect, so the full
	 * RPC round trip is exercised.
	 */
	$connectToDataConnectionDriver(driverId: string, mechanismId: string, params: DataConnectionParameterValuesDTO): Promise<number>;

	/**
	 * Checks whether a connection is read-only via the main thread service.
	 */
	$connectionIsReadOnlyViaService(connectionHandle: number): Promise<boolean>;

	/**
	 * Gets top-level children of a connection via the main thread service.
	 */
	$connectionGetChildrenViaService(connectionHandle: number): Promise<IDataConnectionNodeDTO[]>;

	/**
	 * Disconnects a connection via the main thread service.
	 */
	$connectionDisconnectViaService(connectionHandle: number): Promise<void>;

	/**
	 * Checks whether a connection is still connected via the main thread service.
	 */
	$connectionIsConnectedViaService(connectionHandle: number): Promise<boolean>;

	/**
	 * Gets children of a node via the main thread service.
	 */
	$nodeGetChildrenViaService(connectionHandle: number, nodeHandle: number): Promise<IDataConnectionNodeDTO[]>;

	/**
	 * Previews a node via the main thread service.
	 */
	$nodePreviewViaService(connectionHandle: number, nodeHandle: number): Promise<void>;

	/**
	 * Releases a connection handle via the main thread service.
	 */
	$releaseConnectionViaService(connectionHandle: number): void;
}

/**
 * Extension host side of the data connections RPC channel. The main thread
 * calls these methods to connect, browse the schema tree, and manage the
 * lifecycle of connections that live in the extension process.
 */
export interface ExtHostDataConnectionsShape {
	$driverConnect(driverId: string, mechanismId: string, params: DataConnectionParameterValuesDTO): Promise<number>;
	$generateConnectionCode(driverId: string, mechanismId: string, languageId: string, params: DataConnectionParameterValuesDTO): Promise<IDataConnectionCodeVariantDTO[]>;
	$redactParameterValue(driverId: string, mechanismId: string, parameterId: string, value: string): Promise<string | undefined>;
	$connectionIsReadOnly(connectionHandle: number): Promise<boolean>;
	$connectionGetChildren(connectionHandle: number): Promise<IDataConnectionNodeDTO[]>;
	$connectionDisconnect(connectionHandle: number): Promise<void>;
	$connectionIsConnected(connectionHandle: number): Promise<boolean>;
	$nodeGetChildren(connectionHandle: number, nodeHandle: number): Promise<IDataConnectionNodeDTO[]>;
	$nodePreview(connectionHandle: number, nodeHandle: number): Promise<void>;
	$releaseConnection(connectionHandle: number): void;
}

/**
 * Main thread side of the data explorer RPC channel. A backend-providing extension calls these to
 * register/unregister its RPC handler, push frontend UI events, and ask Positron to open a dataset
 * in the Data Explorer.
 */
export interface MainThreadDataExplorerShape extends IDisposable {
	$registerRpcHandler(providerId: string): void;
	$unregisterRpcHandler(providerId: string): void;
	$sendUiEvent(event: IDataExplorerUiEventDto): void;
	$open(providerId: string, datasetId: string, displayName: string): Promise<void>;
}

/**
 * Extension host side of the data explorer RPC channel. The main thread calls this to service a
 * Data Explorer request via the extension that registered `providerId`.
 */
export interface ExtHostDataExplorerShape {
	$handleRpc(providerId: string, rpc: IDataExplorerRpcDto): Promise<IDataExplorerResponseDto>;
}

export interface MainThreadEnvironmentShape extends IDisposable {
	$getEnvironmentContributions(): Promise<Record<string, EnvironmentVariableAction[]>>;
}

export interface ExtHostEnvironmentShape { }

export interface MainThreadAiFeaturesShape {
	$registerChatAgent(agentData: IChatAgentData): Thenable<void>;
	$unregisterChatAgent(id: string): void;
	$getCurrentPlotUri(): Promise<string | undefined>;
	$getPositronChatContext(request: IChatRequestData): Thenable<IPositronChatContext>;
	$responseProgress(sessionResource: URI, dto: IChatProgressDto): void;
	$languageModelConfig(id: string, options?: IShowLanguageModelConfigOptions): Thenable<void>;
	$getChatExport(): Thenable<object | undefined>;
	$registerProvider(registration: IPositronLanguageModelSource): void;
	$unregisterProvider(id: string): void;
	$updateProvider(id: string, update: Partial<IPositronLanguageModelSource>): void;
	$getRegisteredProviders(): Promise<IPositronLanguageModelSource[]>;
	$areCompletionsEnabled(file: UriComponents): Thenable<boolean>;
	$getCurrentProvider(): Thenable<IPositronChatProvider | undefined>;
	$getCurrentChatMode(): Thenable<string | undefined>;
	$getProviders(): Thenable<IPositronChatProvider[]>;
	$setCurrentProvider(id: string): Thenable<IPositronChatProvider | undefined>;
	$getEnabledProviders(): Thenable<string[]>;
}

export interface ExtHostAiFeaturesShape {
	$responseProviderAction(source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string): Thenable<void>;
	$onCompleteLanguageModelConfig(id: string): void;
	$onDidChangeProviderConfig(source: IPositronLanguageModelSource): void;
	getCurrentProvider(): Thenable<IPositronChatProvider | undefined>;
	getCurrentChatMode(): Thenable<string | undefined>;
	getProviders(): Thenable<IPositronChatProvider[]>;
	setCurrentProvider(id: string): Thenable<IPositronChatProvider | undefined>;
}

export interface MainThreadPlotsServiceShape {
	$getPlotsRenderSettings(): Promise<PlotRenderSettings>;
}

export interface ExtHostPlotsServiceShape {
	$onDidChangePlotsRenderSettings(settings: PlotRenderSettings): void;
}


/**
 * Data transfer object for notebook cell output information.
 * Supports both text and binary (image) outputs.
 */
export interface INotebookCellOutputDTO {
	/** MIME type of the output (e.g., 'text/plain', 'image/png') */
	mimeType: string;
	/** Output data - plain text for text outputs, base64 encoded for images */
	data: string;
}

/**
 * Interface that the main process exposes to the extension host for notebook features.
 */
export interface MainThreadNotebookFeaturesShape extends IDisposable {
	$getActiveNotebookContext(): Promise<INotebookContextDTO | undefined>;
	$getCells(notebookUri: string): Promise<notebooks.NotebookCell[]>;
	$getCell(notebookUri: string, cellIndex: number): Promise<notebooks.NotebookCell | undefined>;
	$runCells(notebookUri: string, cellIndices: number[]): Promise<void>;
	$addCell(notebookUri: string, type: NotebookCellType, index: number, content: string): Promise<number>;
	$deleteCell(notebookUri: string, cellIndex: number): Promise<void>;
	$deleteCells(notebookUri: string, cellIndices: number[]): Promise<void>;
	$updateCellContent(notebookUri: string, cellIndex: number, content: string): Promise<void>;
	$getCellOutputs(notebookUri: string, cellIndex: number): Promise<INotebookCellOutputDTO[]>;
	$moveCell(notebookUri: string, fromIndex: number, toIndex: number): Promise<void>;
	$reorderCells(notebookUri: string, newOrder: number[]): Promise<void>;
	$scrollToCellIfNeeded(notebookUri: string, cellIndex: number): Promise<void>;
	$clearCellOutputs(notebookUri: string, cellIndices?: number[]): Promise<void>;
}

/**
 * Interface to the main thread exposed by the extension host for notebook features.
 */
export interface ExtHostNotebookFeaturesShape {
	// Future: could add events like $onDidExecuteCell
}

/**
 * The view state of a preview in the Preview panel. Only one preview can be
 * active at a time (the one currently loaded into the panel); the active
 * preview also has a visibility state (visible or hidden) that tracks the
 * visibility of the panel itself.
 */
export interface PreviewPanelViewStateData {
	[handle: string]: {
		readonly active: boolean;
		readonly visible: boolean;
	};
}

export type PreviewHandle = string;

export interface ExtHostPreviewPanelShape {
	$onDidChangePreviewPanelViewStates(newState: PreviewPanelViewStateData): void;
	$onDidDisposePreviewPanel(handle: PreviewHandle): Promise<void>;
}

/**
 * Preview content options. This is a strict subset of `WebviewContentOptions`
 * and contains only the options that are supported by the preview panel.
 */
export interface IPreviewContentOptions {
	readonly enableScripts?: boolean;
	readonly enableForms?: boolean;
	readonly localResourceRoots?: readonly UriComponents[];
	readonly portMapping?: readonly IWebviewPortMapping[];
}

/**
 * The initial data needed to create a preview panel.
 */
export interface IPreviewInitData {
	readonly title: string;
	readonly webviewOptions: IPreviewContentOptions;
}

export interface MainThreadPreviewPanelShape extends IDisposable {
	$createPreviewPanel(
		extension: WebviewExtensionDescription,
		handle: PreviewHandle,
		viewType: string,
		initData: IPreviewInitData,
		preserveFocus: boolean,
	): void;
	$previewUrl(
		extension: WebviewExtensionDescription,
		handle: PreviewHandle,
		uri: URI,
		source?: { type: string; id: string }
	): void;
	$previewHtml(
		extension: WebviewExtensionDescription,
		handle: PreviewHandle,
		path: string
	): void;
	$disposePreview(handle: PreviewHandle): void;
	$reveal(handle: PreviewHandle, preserveFocus: boolean): void;
	$setTitle(handle: PreviewHandle, value: string): void;
}

export interface MainThreadLifecycleShape extends IDisposable {
}

export interface ExtHostLifecycleShape {
	$onWillShutdown(reason: ShutdownReason): Promise<void>;
}

export interface MainThreadFileTransferShape extends IDisposable {
}

export interface ExtHostFileTransferShape {
	$onDidUploadFile(resource: UriComponents): void;
	$onDidDownloadFile(resource: UriComponents): void;
}

/**
 * Mirrors the workbench's `ShutdownReason` so it can be transferred over RPC
 * without importing renderer-only modules into the extension host.
 */
export const enum ShutdownReason {
	Close = 1,
	Quit = 2,
	Reload = 3,
	Load = 4,
}

export interface IMainPositronContext extends IRPCProtocol {
}

export const ExtHostPositronContext = {
	ExtHostLanguageRuntime: createProxyIdentifier<ExtHostLanguageRuntimeShape>('ExtHostLanguageRuntime'),
	ExtHostPreviewPanel: createProxyIdentifier<ExtHostPreviewPanelShape>('ExtHostPreviewPanel'),
	ExtHostModalDialogs: createProxyIdentifier<ExtHostModalDialogsShape>('ExtHostModalDialogs'),
	ExtHostConsoleService: createProxyIdentifier<ExtHostConsoleServiceShape>('ExtHostConsoleService'),
	ExtHostContextKeyService: createProxyIdentifier<ExtHostContextKeyServiceShape>('ExtHostContextKeyService'),
	ExtHostMethods: createProxyIdentifier<ExtHostMethodsShape>('ExtHostMethods'),
	ExtHostEnvironment: createProxyIdentifier<ExtHostEnvironmentShape>('ExtHostEnvironment'),
	ExtHostConnections: createProxyIdentifier<ExtHostConnectionsShape>('ExtHostConnections'),
	ExtHostAiFeatures: createProxyIdentifier<ExtHostAiFeaturesShape>('ExtHostAiFeatures'),
	ExtHostQuickOpen: createProxyIdentifier<ExtHostQuickOpenShape>('ExtHostQuickOpen'),
	ExtHostPlotsService: createProxyIdentifier<ExtHostPlotsServiceShape>('ExtHostPlotsService'),
	ExtHostNotebookFeatures: createProxyIdentifier<ExtHostNotebookFeaturesShape>('ExtHostNotebookFeatures'),
	ExtHostDataConnections: createProxyIdentifier<ExtHostDataConnectionsShape>('ExtHostDataConnections'),
	ExtHostDataExplorer: createProxyIdentifier<ExtHostDataExplorerShape>('ExtHostDataExplorer'),
	ExtHostLifecycle: createProxyIdentifier<ExtHostLifecycleShape>('ExtHostLifecycle'),
	ExtHostFileTransfer: createProxyIdentifier<ExtHostFileTransferShape>('ExtHostFileTransfer'),
};

export interface MainThreadPositronEphemeralStorageShape extends IDisposable {
	$initializeEphemeralStorage(extensionId: string): Promise<string | undefined>;
	$setEphemeralValue(extensionId: string, value: string): Promise<void>;
	$deleteEphemeralValue(extensionId: string): Promise<void>;
}

export const MainPositronContext = {
	MainThreadLanguageRuntime: createProxyIdentifier<MainThreadLanguageRuntimeShape>('MainThreadLanguageRuntime'),
	MainThreadPreviewPanel: createProxyIdentifier<MainThreadPreviewPanelShape>('MainThreadPreviewPanel'),
	MainThreadModalDialogs: createProxyIdentifier<MainThreadModalDialogsShape>('MainThreadModalDialogs'),
	MainThreadConsoleService: createProxyIdentifier<MainThreadConsoleServiceShape>('MainThreadConsoleService'),
	MainThreadEnvironment: createProxyIdentifier<MainThreadEnvironmentShape>('MainThreadEnvironment'),
	MainThreadContextKeyService: createProxyIdentifier<MainThreadContextKeyServiceShape>('MainThreadContextKeyService'),
	MainThreadMethods: createProxyIdentifier<MainThreadMethodsShape>('MainThreadMethods'),
	MainThreadConnections: createProxyIdentifier<MainThreadConnectionsShape>('MainThreadConnections'),
	MainThreadAiFeatures: createProxyIdentifier<MainThreadAiFeaturesShape>('MainThreadAiFeatures'),
	MainThreadPlotsService: createProxyIdentifier<MainThreadPlotsServiceShape>('MainThreadPlotsService'),
	MainThreadNotebookFeatures: createProxyIdentifier<MainThreadNotebookFeaturesShape>('MainThreadNotebookFeatures'),
	MainThreadPositronEphemeralStorage: createProxyIdentifier<MainThreadPositronEphemeralStorageShape>('MainThreadPositronEphemeralStorage'),
	MainThreadDataConnections: createProxyIdentifier<MainThreadDataConnectionsShape>('MainThreadDataConnections'),
	MainThreadDataExplorer: createProxyIdentifier<MainThreadDataExplorerShape>('MainThreadDataExplorer'),
	MainThreadLifecycle: createProxyIdentifier<MainThreadLifecycleShape>('MainThreadLifecycle'),
	MainThreadFileTransfer: createProxyIdentifier<MainThreadFileTransferShape>('MainThreadFileTransfer'),
};
