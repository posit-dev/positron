/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostLanguageRuntime } from 'vs/workbench/api/common/positron/extHostLanguageRuntime';
import type * as positron from 'positron';
import type * as vscode from 'vscode';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionRegistries } from 'vs/workbench/api/common/extHost.api.impl';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtHostConfigProvider } from 'vs/workbench/api/common/extHostConfiguration';
import { ExtHostPositronContext } from 'vs/workbench/api/common/positron/extHost.positron.protocol';
import * as extHostTypes from 'vs/workbench/api/common/positron/extHostTypes.positron';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';

/**
 * Factory interface for creating an instance of the Positron API.
 */
export interface IExtensionPositronApiFactory {
	(extension: IExtensionDescription, extensionInfo: IExtensionRegistries, configProvider: ExtHostConfigProvider): typeof positron;
}

/**
 * This method instantiates and returns the extension API surface for Positron;
 * it mirrors IExtensionApiFactory for VS Code.
 */
export function createPositronApiFactoryAndRegisterActors(accessor: ServicesAccessor): IExtensionPositronApiFactory {
	const rpcProtocol = accessor.get(IExtHostRpcService);
	const initData = accessor.get(IExtHostInitDataService);
	const extHostLanguageRuntime = rpcProtocol.set(ExtHostPositronContext.ExtHostLanguageRuntime, new ExtHostLanguageRuntime(rpcProtocol));

	return function (extension: IExtensionDescription, extensionInfo: IExtensionRegistries, configProvider: ExtHostConfigProvider): typeof positron {

		// --- Start Positron ---
		const runtime: typeof positron.runtime = {
			registerLanguageRuntime(runtime: positron.LanguageRuntime): vscode.Disposable {
				return extHostLanguageRuntime.registerLanguageRuntime(runtime);
			}
		};
		// --- End Positron ---

		return <typeof positron>{
			version: initData.positronVersion,
			runtime,
			RuntimeClientType: extHostTypes.RuntimeClientType,
			RuntimeClientState: extHostTypes.RuntimeClientState,
			LanguageRuntimeMessageType: extHostTypes.LanguageRuntimeMessageType,
			LanguageRuntimeEventType: extHostTypes.LanguageRuntimeEventType,
			RuntimeCodeExecutionMode: extHostTypes.RuntimeCodeExecutionMode,
			RuntimeErrorBehavior: extHostTypes.RuntimeErrorBehavior,
			RuntimeOnlineState: extHostTypes.RuntimeOnlineState,
			RuntimeState: extHostTypes.RuntimeState,
		};
	};
}
