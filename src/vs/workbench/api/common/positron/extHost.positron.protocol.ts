/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeInfo, ILanguageRuntimeMetadata, RuntimeClientType, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, ILanguageRuntimeMessage, ILanguageRuntimeDynState, ILanguageRuntimeExit, RuntimeExitReason } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { createProxyIdentifier, IRPCProtocol } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import { IWebviewPortMapping, WebviewExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { URI, UriComponents } from 'vs/base/common/uri';

// This is the interface that the main process exposes to the extension host
export interface MainThreadLanguageRuntimeShape extends IDisposable {
	$registerLanguageRuntime(handle: number, metadata: ILanguageRuntimeMetadata, dynState: ILanguageRuntimeDynState): void;
	$selectLanguageRuntime(handle: number): Promise<void>;
	$restartLanguageRuntime(handle: number): Promise<void>;
	$completeLanguageRuntimeDiscovery(): void;
	$unregisterLanguageRuntime(handle: number): void;
	$executeCode(languageId: string, code: string, focus: boolean): Promise<boolean>;
	$getPreferredRuntime(languageId: string): Promise<ILanguageRuntimeMetadata>;
	$getRunningRuntimes(languageId: string): Promise<ILanguageRuntimeMetadata[]>;
	$emitLanguageRuntimeMessage(handle: number, message: ILanguageRuntimeMessage): void;
	$emitLanguageRuntimeState(handle: number, clock: number, state: RuntimeState): void;
	$emitLanguageRuntimeExit(handle: number, exit: ILanguageRuntimeExit): void;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostLanguageRuntimeShape {
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$openResource(handle: number, resource: URI | string): Promise<boolean>;
	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void;
	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus>;
	$createClient(handle: number, id: string, type: RuntimeClientType, params: any): Promise<void>;
	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>>;
	$removeClient(handle: number, id: string): void;
	$sendClientMessage(handle: number, client_id: string, message_id: string, message: any): void;
	$replyToPrompt(handle: number, id: string, response: string): void;
	$interruptLanguageRuntime(handle: number): Promise<void>;
	$restartLanguageRuntime(handle: number): Promise<void>;
	$shutdownLanguageRuntime(handle: number, exitReason: RuntimeExitReason): Promise<void>;
	$forceQuitLanguageRuntime(handle: number): Promise<void>;
	$showOutputLanguageRuntime(handle: number): void;
	$provideLanguageRuntime(languageId: string, runtimeMetadata: ILanguageRuntimeMetadata): Promise<void>;
	$discoverLanguageRuntimes(): void;
}

// This is the interface that the main process exposes to the extension host
export interface MainThreadModalDialogsShape extends IDisposable {
	$showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Promise<boolean>;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostModalDialogsShape { }

export interface ExtHostConsoleShape {
	$onDidChangeConsoleWidth(newWidth: number): void;
}

export interface MainThreadConsoleShape { }

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
	ExtHostConsole: createProxyIdentifier<ExtHostConsoleShape>('ExtHostConsole'),
};

export const MainPositronContext = {
	MainThreadLanguageRuntime: createProxyIdentifier<MainThreadLanguageRuntimeShape>('MainThreadLanguageRuntime'),
	MainThreadPreviewPanel: createProxyIdentifier<MainThreadPreviewPanelShape>('MainThreadPreviewPanel'),
	MainThreadModalDialogs: createProxyIdentifier<MainThreadModalDialogsShape>('MainThreadModalDialogs'),
	MainThreadConsole: createProxyIdentifier<MainThreadConsoleShape>('MainThreadConsole'),
};
