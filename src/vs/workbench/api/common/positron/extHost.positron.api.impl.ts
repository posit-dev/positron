/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
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

export interface IExtensionPositronApiFactory {
	(extension: IExtensionDescription, extensionInfo: IExtensionRegistries, configProvider: ExtHostConfigProvider): typeof positron;
}

/**
 * This method instantiates and returns the extension API surface
 */
export function createApiFactoryAndRegisterActors(accessor: ServicesAccessor): IExtensionPositronApiFactory {
	const rpcProtocol = accessor.get(IExtHostRpcService);
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
			runtime,
			LanguageRuntimeMessageType: extHostTypes.LanguageRuntimeMessageType,
			RuntimeCodeExecutionMode: extHostTypes.RuntimeCodeExecutionMode,
			RuntimeErrorBehavior: extHostTypes.RuntimeErrorBehavior,
			RuntimeOnlineState: extHostTypes.RuntimeOnlineState,
			RuntimeState: extHostTypes.RuntimeState,
		};
	};
}
