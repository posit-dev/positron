/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimeInfo, ILanguageRuntimeMetadata, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, ILanguageRuntimeMessage, ILanguageRuntimeExit, RuntimeExitReason, LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { createProxyIdentifier, IRPCProtocol, SerializableObjectWithBuffers } from '../../../services/extensions/common/proxyIdentifier.js';
import { MainContext, IWebviewPortMapping, WebviewExtensionDescription, IChatProgressDto, ExtHostQuickOpenShape } from '../extHost.protocol.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IEditorContext } from '../../../services/frontendMethods/common/editorContext.js';
import { RuntimeClientType, LanguageRuntimeSessionChannel, NotebookCellType } from './extHostTypes.positron.js';
import { ActiveRuntimeSessionMetadata, EnvironmentVariableAction, LanguageRuntimeDynState, RuntimeSessionMetadata } from 'positron';
import { IDriverMetadata, Input } from '../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { IAvailableDriverMethods } from '../../browser/positron/mainThreadConnections.js';
import { IChatRequestData, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IChatAgentData } from '../../../contrib/chat/common/chatAgents.js';
import { PlotRenderSettings } from '../../../services/positronPlots/common/positronPlots.js';
import { QueryTableSummaryResult, Variable } from '../../../services/languageRuntime/common/positronVariablesComm.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { IPositronChatProvider } from '../../../contrib/chat/common/languageModels.js';

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


// This is the interface that the main process exposes to the extension host
export interface MainThreadLanguageRuntimeShape extends IDisposable {
	$registerLanguageRuntime(metadata: ILanguageRuntimeMetadata): void;
	$selectLanguageRuntime(runtimeId: string): Promise<void>;
	$startLanguageRuntime(runtimeId: string, sessionName: string, sessionMode: LanguageRuntimeSessionMode, notebookUri: URI | undefined): Promise<string>;
	$completeLanguageRuntimeDiscovery(): void;
	$unregisterLanguageRuntime(runtimeId: string): void;
	$executeCode(languageId: string, extensionId: string, sessionId: string | undefined, code: string, focus: boolean, allowIncomplete?: boolean, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior, executionId?: string): Promise<string>;
	$getPreferredRuntime(languageId: string): Promise<ILanguageRuntimeMetadata | undefined>;
	$getRegisteredRuntimes(): Promise<ILanguageRuntimeMetadata[]>;
	$getActiveSessions(): Promise<ActiveRuntimeSessionMetadata[]>;
	$getSession(sessionId: string): Promise<ActiveRuntimeSessionMetadata | undefined>;
	$getForegroundSession(): Promise<ActiveRuntimeSessionMetadata | undefined>;
	$getNotebookSession(notebookUri: URI): Promise<ActiveRuntimeSessionMetadata | undefined>;
	$restartSession(sessionId: string): Promise<void>;
	$interruptSession(sessionId: string): Promise<void>;
	$focusSession(sessionId: string): void;
	$deleteSession(sessionId: string): Promise<boolean>;
	$shutdownSession(sessionId: string, exitReason: RuntimeExitReason): Promise<void>;
	$executeInSession(sessionId: string, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): Promise<void>;
	$getSessionDynState(sessionId: string): Promise<LanguageRuntimeDynState>;
	$getSessionVariables(sessionId: string, accessKeys?: Array<Array<string>>): Promise<Array<Array<Variable>>>;
	$querySessionTables(sessionId: string, accessKeys: Array<Array<string>>, queryTypes: Array<string>): Promise<Array<QueryTableSummaryResult>>;
	$callMethod(sessionId: string, method: string, args: any[]): Thenable<any>;
	$emitLanguageRuntimeMessage(sessionId: string, handled: boolean, message: SerializableObjectWithBuffers<ILanguageRuntimeMessage>): void;
	$emitLanguageRuntimeState(sessionId: string, clock: number, state: RuntimeState): void;
	$emitLanguageRuntimeExit(sessionId: string, exit: ILanguageRuntimeExit): void;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostLanguageRuntimeShape {
	$isHostForLanguageRuntime(runtimeMetadata: ILanguageRuntimeMetadata): Promise<boolean>;
	$createLanguageRuntimeSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata): Promise<RuntimeInitialState>;
	$restoreLanguageRuntimeSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata, sessionName: string): Promise<RuntimeInitialState>;
	$validateLanguageRuntimeMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata>;
	$validateLanguageRuntimeSession(metadata: ILanguageRuntimeMetadata, sessionId: string): Promise<boolean>;
	$disposeLanguageRuntime(handle: number): Promise<void>;
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$openResource(handle: number, resource: URI | string): Promise<boolean>;
	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior, executionId?: string): void;
	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus>;
	$createClient(handle: number, id: string, type: RuntimeClientType, params: any, metadata?: any): Promise<void>;
	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>>;
	$removeClient(handle: number, id: string): void;
	$sendClientMessage(handle: number, client_id: string, message_id: string, message: any): void;
	$replyToPrompt(handle: number, id: string, response: string): void;
	$setWorkingDirectory(handle: number, directory: string): Promise<void>;
	$interruptLanguageRuntime(handle: number): Promise<void>;
	$restartSession(handle: number, workingDirectory?: string): Promise<void>;
	$callMethod(handle: number, method: string, args: any[]): Thenable<any>;
	$shutdownLanguageRuntime(handle: number, exitReason: RuntimeExitReason): Promise<void>;
	$forceQuitLanguageRuntime(handle: number): Promise<void>;
	$showOutputLanguageRuntime(handle: number, channel?: LanguageRuntimeSessionChannel): void;
	$listOutputChannelsLanguageRuntime(handle: number): Promise<LanguageRuntimeSessionChannel[]>;
	$updateSessionNameLanguageRuntime(handle: number, sessionName: string): void;
	$showProfileLanguageRuntime(handle: number): void;
	$discoverLanguageRuntimes(disabledLanguageIds: string[]): void;
	$recommendWorkspaceRuntimes(disabledLanguageIds: string[]): Promise<ILanguageRuntimeMetadata[]>;
	$notifyForegroundSessionChanged(sessionId: string | undefined): void;
	$notifyCodeExecuted(event: ILanguageRuntimeCodeExecutedEvent): void;
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
	$driverGenerateCode(driverId: string, inputs: Input[]): Promise<string>;
	$driverConnect(driverId: string, code: string): Promise<void>;
	$driverCheckDependencies(driverId: string): Promise<boolean>;
	$driverInstallDependencies(driverId: string): Promise<boolean>;
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
	$responseProgress(sessionId: string, dto: IChatProgressDto): void;
	$languageModelConfig(id: string, sources: IPositronLanguageModelSource[]): Thenable<void>;
	$getSupportedProviders(): Thenable<string[]>;
	$getChatExport(): Thenable<object | undefined>;
	$addLanguageModelConfig(source: IPositronLanguageModelSource): void;
	$removeLanguageModelConfig(source: IPositronLanguageModelSource): void;
	$areCompletionsEnabled(file: UriComponents): Thenable<boolean>;
	$getCurrentProvider(): Thenable<IPositronChatProvider | undefined>;
	$getProviders(): Thenable<IPositronChatProvider[]>;
	$setCurrentProvider(id: string): Thenable<IPositronChatProvider | undefined>;
}

export interface ExtHostAiFeaturesShape {
	$responseLanguageModelConfig(id: string, config: IPositronLanguageModelConfig, action: string): Thenable<void>;
	$onCompleteLanguageModelConfig(id: string): void;
	getCurrentProvider(): Thenable<IPositronChatProvider | undefined>;
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
 * Data transfer object for notebook cell information.
 */
export interface INotebookCellDTO {
	id: string;
	index: number;
	type: NotebookCellType;
	content: string;
	hasOutput: boolean;
	selectionStatus: string;
	executionStatus?: string;
	executionOrder?: number;
	lastRunSuccess?: boolean;
	lastExecutionDuration?: number;
	lastRunEndTime?: number;
}

/**
 * Data transfer object for notebook context information.
 */
export interface INotebookContextDTO {
	uri: string;
	kernelId?: string;
	kernelLanguage?: string;
	cellCount: number;
	selectedCells: INotebookCellDTO[];
	allCells?: INotebookCellDTO[];
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
	$getCells(notebookUri: string): Promise<INotebookCellDTO[]>;
	$getCell(notebookUri: string, cellId: string): Promise<INotebookCellDTO | undefined>;
	$runCells(notebookUri: string, cellIds: string[]): Promise<void>;
	$addCell(notebookUri: string, type: NotebookCellType, index: number, content: string): Promise<string>;
	$deleteCell(notebookUri: string, cellId: string): Promise<void>;
	$updateCellContent(notebookUri: string, cellId: string, content: string): Promise<void>;
	$getCellOutputs(notebookUri: string, cellId: string): Promise<INotebookCellOutputDTO[]>;
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
		uri: URI
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
};

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
};
