/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeInfo, ILanguageRuntimeMetadata, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, ILanguageRuntimeMessage, ILanguageRuntimeExit, RuntimeExitReason, LanguageRuntimeSessionMode } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { createProxyIdentifier, IRPCProtocol, SerializableObjectWithBuffers } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import { MainContext, IWebviewPortMapping, WebviewExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IEditorContext } from 'vs/workbench/services/frontendMethods/common/editorContext';
import { RuntimeClientType } from 'vs/workbench/api/common/positron/extHostTypes.positron';
import { LanguageRuntimeDynState, RuntimeSessionMetadata } from 'positron';

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
	$executeCode(languageId: string, code: string, focus: boolean, allowIncomplete?: boolean): Promise<boolean>;
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
	$validateLangaugeRuntimeMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata>;
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$openResource(handle: number, resource: URI | string): Promise<boolean>;
	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void;
	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus>;
	$createClient(handle: number, id: string, type: RuntimeClientType, params: any, metadata?: any): Promise<void>;
	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>>;
	$removeClient(handle: number, id: string): void;
	$sendClientMessage(handle: number, client_id: string, message_id: string, message: any): void;
	$replyToPrompt(handle: number, id: string, response: string): void;
	$interruptLanguageRuntime(handle: number): Promise<void>;
	$restartSession(handle: number): Promise<void>;
	$shutdownLanguageRuntime(handle: number, exitReason: RuntimeExitReason): Promise<void>;
	$forceQuitLanguageRuntime(handle: number): Promise<void>;
	$showOutputLanguageRuntime(handle: number): void;
	$showProfileLanguageRuntime(handle: number): void;
	$discoverLanguageRuntimes(): void;
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
};

export const MainPositronContext = {
	MainThreadLanguageRuntime: createProxyIdentifier<MainThreadLanguageRuntimeShape>('MainThreadLanguageRuntime'),
	MainThreadPreviewPanel: createProxyIdentifier<MainThreadPreviewPanelShape>('MainThreadPreviewPanel'),
	MainThreadModalDialogs: createProxyIdentifier<MainThreadModalDialogsShape>('MainThreadModalDialogs'),
	MainThreadConsoleService: createProxyIdentifier<MainThreadConsoleServiceShape>('MainThreadConsoleService'),
	MainThreadContextKeyService: createProxyIdentifier<MainThreadContextKeyServiceShape>('MainThreadContextKeyService'),
	MainThreadMethods: createProxyIdentifier<MainThreadMethodsShape>('MainThreadMethods'),
};
