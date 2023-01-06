/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMetadata, LanguageRuntimeHistoryType, RuntimeClientState, RuntimeClientType, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { createProxyIdentifier, IRPCProtocol } from 'vs/workbench/services/extensions/common/proxyIdentifier';

// This is the interface that the main process exposes to the extension host
export interface MainThreadLanguageRuntimeShape extends IDisposable {
	$registerLanguageRuntime(handle: number, metadata: ILanguageRuntimeMetadata): void;
	$unregisterLanguageRuntime(handle: number): void;
	$emitLanguageRuntimeMessage(handle: number, message: ILanguageRuntimeMessage): void;
	$emitLanguageRuntimeState(handle: number, state: RuntimeState): void;
	$emitRuntimeClientMessage(handle: number, id: string, message: ILanguageRuntimeMessage): void;
	$emitRuntimeClientState(handle: number, id: string, state: RuntimeClientState): void;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostLanguageRuntimeShape {
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void;
	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus>;
	$getExecutionHistory(handle: number, type: LanguageRuntimeHistoryType, max: number): Promise<string[][]>;
	$createClient(handle: number, type: RuntimeClientType): Promise<string>;
	$removeClient(handle: number, id: string): void;
	$sendClientMessage(handle: number, id: string, message: any): void;
	$replyToPrompt(handle: number, id: string, response: string): void;
	$interruptLanguageRuntime(handle: number): void;
	$restartLanguageRuntime(handle: number): void;
	$shutdownLanguageRuntime(handle: number): void;
}

export interface IMainPositronContext extends IRPCProtocol {
}

export const ExtHostPositronContext = {
	ExtHostLanguageRuntime: createProxyIdentifier<ExtHostLanguageRuntimeShape>('ExtHostLanguageRuntime'),
};

export const MainPositronContext = {
	MainThreadLanguageRuntime: createProxyIdentifier<MainThreadLanguageRuntimeShape>('MainThreadLanguageRuntime'),
};
