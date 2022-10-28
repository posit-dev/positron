/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMetadata, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { createProxyIdentifier, IRPCProtocol } from 'vs/workbench/services/extensions/common/proxyIdentifier';

// This is the interface that the main process exposes to the extension host
export interface MainThreadLanguageRuntimeShape extends IDisposable {
	$registerLanguageRuntime(handle: number, metadata: ILanguageRuntimeMetadata): void;
	$unregisterLanguageRuntime(handle: number): void;
	$emitLanguageRuntimeMessage(handle: number, message: ILanguageRuntimeMessage): void;
	$emitLanguageRuntimeState(handle: number, state: RuntimeState): void;
}

// The interface to the main thread exposed by the extension host
export interface ExtHostLanguageRuntimeShape {
	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo>;
	$executeCode(handle: number, code: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): Promise<string>;
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
