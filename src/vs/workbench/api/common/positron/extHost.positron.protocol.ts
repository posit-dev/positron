/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimeInfo, ILanguageRuntimeMetadata, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, ILanguageRuntimeMessage, ILanguageRuntimeExit, RuntimeExitReason, LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { createProxyIdentifier, IRPCProtocol, SerializableObjectWithBuffers } from '../../../services/extensions/common/proxyIdentifier.js';
import { MainContext, IWebviewPortMapping, WebviewExtensionDescription, IChatProgressDto } from '../extHost.protocol.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IEditorContext } from '../../../services/frontendMethods/common/editorContext.js';
import { RuntimeClientType } from './extHostTypes.positron.js';
import { LanguageRuntimeDynState, RuntimeSessionMetadata } from 'positron';
import { IDriverMetadata, Input } from '../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { IAvailableDriverMethods } from '../../browser/positron/mainThreadConnections.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IPositronChatContext, IPositronChatParticipant } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { IChatAgentHistoryEntry, IChatAgentRequest, IChatAgentResult } from '../../../contrib/chat/common/chatAgents.js';

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
	$registerLanguageRuntime(handle: number, metadata: ILanguageRuntimeMetadata): void;
	$selectLanguageRuntime(runtimeId: string): Promise<void>;
	$startLanguageRuntime(runtimeId: string, sessionName: string, sessionMode: LanguageRuntimeSessionMode, notebookUri: URI | undefined): Promise<string>;
	$completeLanguageRuntimeDiscovery(): void;
	$unregisterLanguageRuntime(handle: number): void;
	$executeCode(languageId: string, code: string, focus: boolean, allowIncomplete?: boolean, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior): Promise<boolean>;
	$getPreferredRuntime(languageId: string): Promise<ILanguageRuntimeMetadata>;
	$getForegroundSession(): Promise<string | undefined>;
	$getNotebookSession(notebookUri: URI): Promise<string | undefined>;
	$restartSession(handle: number): Promise<void>;
	$emitLanguageRuntimeMessage(handle: number, handled: boolean, message: SerializableObjectWithBuffers<ILanguageRuntimeMessage>): void;
	$emitLanguageRuntimeState(handle: number, clock: number, state: RuntimeState): void;
	$emitLanguageRuntimeExit(handle: number, exit: ILanguageRuntimeExit): void;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostLanguageRuntimeShape {
	$isHostForLanguageRuntime(runtimeMetadata: ILanguageRuntimeMetadata): Promise<boolean>;
	$createLanguageRuntimeSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata): Promise<RuntimeInitialState>;
	$restoreLanguageRuntimeSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata): Promise<RuntimeInitialState>;
	$validateLanguageRuntimeMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata>;
	$validateLanguageRuntimeSession(metadata: ILanguageRuntimeMetadata, sessionId: string): Promise<boolean>;
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$openResource(handle: number, resource: URI | string): Promise<boolean>;
	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void;
	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus>;
	$createClient(handle: number, id: string, type: RuntimeClientType, params: any, metadata?: any): Promise<void>;
	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>>;
	$removeClient(handle: number, id: string): void;
	$sendClientMessage(handle: number, client_id: string, message_id: string, message: any): void;
	$replyToPrompt(handle: number, id: string, response: string): void;
	$setWorkingDirectory(handle: number, directory: string): Promise<void>;
	$interruptLanguageRuntime(handle: number): Promise<void>;
	$restartSession(handle: number): Promise<void>;
	$shutdownLanguageRuntime(handle: number, exitReason: RuntimeExitReason): Promise<void>;
	$forceQuitLanguageRuntime(handle: number): Promise<void>;
	$showOutputLanguageRuntime(handle: number): void;
	$showProfileLanguageRuntime(handle: number): void;
	$discoverLanguageRuntimes(disabledLanguageIds: string[]): void;
	$recommendWorkspaceRuntimes(disabledLanguageIds: string[]): Promise<ILanguageRuntimeMetadata[]>;
}

// This is the interface that the main process exposes to the extension host
export interface MainThreadModalDialogsShape extends IDisposable {
	$showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Promise<boolean>;
	$showSimpleModalDialogMessage(title: string, message: string, okButtonTitle?: string): Promise<null>;
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
	$tryPasteText(id: string, text: string): void;
}

export interface ExtHostConsoleServiceShape {
	$onDidChangeConsoleWidth(newWidth: number): void;
	$addConsole(id: string): void;
	$removeConsole(id: string): void;
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

export interface MainThreadAiFeaturesShape {
	$registerChatParticipant(extension: IExtensionDescription, participant: IPositronChatParticipant): void;
	$registerLanguageModel(id: string, extension: IExtensionDescription, name: string): void;
	$unregisterLanguageModel(id: string): void;
	$unregisterChatParticipant(id: string): void;
	$chatTaskResponse(id: string, content: IChatProgressDto): void;
	$getCurrentPlotUri(): Promise<string | undefined>;
}

export interface ExtHostAiFeaturesShape {
	$provideResponse(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], context: IPositronChatContext, taskId: string, token: CancellationToken): Promise<IChatAgentResult>;
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
	ExtHostConnections: createProxyIdentifier<ExtHostConnectionsShape>('ExtHostConnections'),
	ExtHostAiFeatures: createProxyIdentifier<ExtHostAiFeaturesShape>('ExtHostAiFeatures'),
};

export const MainPositronContext = {
	MainThreadLanguageRuntime: createProxyIdentifier<MainThreadLanguageRuntimeShape>('MainThreadLanguageRuntime'),
	MainThreadPreviewPanel: createProxyIdentifier<MainThreadPreviewPanelShape>('MainThreadPreviewPanel'),
	MainThreadModalDialogs: createProxyIdentifier<MainThreadModalDialogsShape>('MainThreadModalDialogs'),
	MainThreadConsoleService: createProxyIdentifier<MainThreadConsoleServiceShape>('MainThreadConsoleService'),
	MainThreadContextKeyService: createProxyIdentifier<MainThreadContextKeyServiceShape>('MainThreadContextKeyService'),
	MainThreadMethods: createProxyIdentifier<MainThreadMethodsShape>('MainThreadMethods'),
	MainThreadConnections: createProxyIdentifier<MainThreadConnectionsShape>('MainThreadConnections'),
	MainThreadAiFeatures: createProxyIdentifier<MainThreadAiFeaturesShape>('MainThreadAiFeatures'),
};
