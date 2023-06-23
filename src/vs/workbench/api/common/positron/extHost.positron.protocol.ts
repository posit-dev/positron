/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeInfo, ILanguageRuntimeMetadata, RuntimeClientType, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, ILanguageRuntimeMessage } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { createProxyIdentifier, IRPCProtocol } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import { IPreviewPaneItemOptions } from 'vs/workbench/services/positronPreview/common/positronPreview';
import { IWebviewPortMapping, WebviewExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { UriComponents } from 'vs/base/common/uri';

// This is the interface that the main process exposes to the extension host
export interface MainThreadLanguageRuntimeShape extends IDisposable {
	$registerLanguageRuntime(handle: number, metadata: ILanguageRuntimeMetadata): void;
	$unregisterLanguageRuntime(handle: number): void;
	$executeCode(languageId: string, code: string, focus: boolean): Promise<boolean>;

	$emitLanguageRuntimeMessage(handle: number, message: ILanguageRuntimeMessage): void;
	$emitLanguageRuntimeState(handle: number, clock: number, state: RuntimeState): void;
}

export interface MainThreadPreviewPaneShape extends IDisposable {
	$createPreviewPaneItem(handle: number, options: IPreviewPaneItemOptions): Thenable<void>;
	$disposePreviewPaneItem(handle: number): Thenable<void>;
	$sendMessageToPreviewPane(handle: number, message: Object): Thenable<void>;
	$isPreviewItemShowing(handle: number): Promise<boolean>;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostLanguageRuntimeShape {
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void;
	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus>;
	$createClient(handle: number, id: string, type: RuntimeClientType, params: any): Promise<void>;
	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>>;
	$removeClient(handle: number, id: string): void;
	$sendClientMessage(handle: number, client_id: string, message_id: string, message: any): void;
	$replyToPrompt(handle: number, id: string, response: string): void;
	$interruptLanguageRuntime(handle: number): Promise<void>;
	$restartLanguageRuntime(handle: number): Promise<void>;
	$shutdownLanguageRuntime(handle: number): Promise<void>;
}

export interface ExtHostPreviewPaneShape {
	$emitMessageFromPreviewPane(handle: number, message: Object): void;
}

export interface PreviewPanelViewStateData {
	[handle: string]: {
		readonly active: boolean;
		readonly visible: boolean;
	};
}

export type PreviewHandle = string;

export interface ExtHostPreviewPanelsShape {
	$onDidChangePreviewPanelViewStates(newState: PreviewPanelViewStateData): void;
	$onDidDisposePreviewPanel(handle: PreviewHandle): Promise<void>;
}

export interface IPreviewContentOptions {
	readonly enableScripts?: boolean;
	readonly enableForms?: boolean;
	readonly localResourceRoots?: readonly UriComponents[];
	readonly portMapping?: readonly IWebviewPortMapping[];
}

export interface IPreviewInitData {
	readonly title: string;
	readonly webviewOptions: IPreviewContentOptions;
}

export interface MainThreadPreviewPanelsShape extends IDisposable {
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
	ExtHostPreviewPane: createProxyIdentifier<ExtHostPreviewPaneShape>('ExtHostPreviewPane'),
	ExtHostPreviewPanels: createProxyIdentifier<ExtHostPreviewPanelsShape>('ExtHostPreviewPanels'),
};

export const MainPositronContext = {
	MainThreadLanguageRuntime: createProxyIdentifier<MainThreadLanguageRuntimeShape>('MainThreadLanguageRuntime'),
	MainThreadPreviewPane: createProxyIdentifier<MainThreadPreviewPaneShape>('MainThreadPreviewPane'),
	MainThreadPreviewPanels: createProxyIdentifier<MainThreadPreviewPanelsShape>('MainThreadPreviewPanels'),
};
