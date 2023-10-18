/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
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
import { ExtHostPreviewPanels } from 'vs/workbench/api/common/positron/extHostPreviewPanels';
import { ExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { ExtHostWebviews } from 'vs/workbench/api/common/extHostWebview';
import { ExtHostLanguageFeatures } from 'vs/workbench/api/common/extHostLanguageFeatures';

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
	const extHostWorkspace = accessor.get(IExtHostWorkspace);

	// Retrieve the raw `ExtHostWebViews` object from the rpcProtocol; this
	// object is needed to create webviews, and was previously created in
	// `createApiFactoryAndRegisterActors` when VS Code's API factory was
	// created earlier.
	//
	// The `getRaw` method is a Positron extension to the `rpcProtocol` that
	// allows us to retrieve the raw actor object so that the Positron API and
	// VS Code API can share a single instance of `ExtHostWebViews`, which is
	// necessary since the instance effectively needs to be a singleton.
	const extHostWebviews: ExtHostWebviews = rpcProtocol.getRaw(ExtHostContext.ExtHostWebviews);
	if (!extHostWebviews) {
		throw new Error('Could not retrieve ExtHostWebviews from the RPC protocol. ' +
			' The VS Code API must be created before the Positron API.');
	}

	// Same deal for the `ExtHostLanguageFeatures` object
	const extHostLanguageFeatures: ExtHostLanguageFeatures =
		rpcProtocol.getRaw(ExtHostContext.ExtHostLanguageFeatures);

	const extHostLanguageRuntime = rpcProtocol.set(ExtHostPositronContext.ExtHostLanguageRuntime, new ExtHostLanguageRuntime(rpcProtocol));
	const extHostPreviewPanels = rpcProtocol.set(ExtHostPositronContext.ExtHostPreviewPanel, new ExtHostPreviewPanels(rpcProtocol, extHostWebviews, extHostWorkspace));

	return function (extension: IExtensionDescription, extensionInfo: IExtensionRegistries, configProvider: ExtHostConfigProvider): typeof positron {

		// --- Start Positron ---
		const runtime: typeof positron.runtime = {
			executeCode(langaugeId, code, focus): Thenable<boolean> {
				return extHostLanguageRuntime.executeCode(langaugeId, code, focus);
			},
			registerLanguageRuntime(runtime: positron.LanguageRuntime): vscode.Disposable {
				return extHostLanguageRuntime.registerLanguageRuntime(runtime);
			},
			registerLanguageRuntimeProvider(languageId: string, provider: positron.LanguageRuntimeProvider): void {
				return extHostLanguageRuntime.registerLanguageRuntimeProvider(languageId, provider);
			},
			getRegisteredRuntimes(): Thenable<positron.LanguageRuntime[]> {
				return extHostLanguageRuntime.getRegisteredRuntimes();
			},
			getPreferredRuntime(languageId: string): Thenable<positron.LanguageRuntime> {
				return extHostLanguageRuntime.getPreferredRuntime(languageId);
			},
			getRunningRuntimes(languageId: string): Thenable<positron.LanguageRuntimeMetadata[]> {
				return extHostLanguageRuntime.getRunningRuntimes(languageId);
			},
			selectLanguageRuntime(runtimeId: string): Thenable<void> {
				return extHostLanguageRuntime.selectLanguageRuntime(runtimeId);
			},
			restartLanguageRuntime(runtimeId: string): Thenable<void> {
				return extHostLanguageRuntime.restartLanguageRuntime(runtimeId);
			},
			registerClientHandler(handler: positron.RuntimeClientHandler): vscode.Disposable {
				return extHostLanguageRuntime.registerClientHandler(handler);
			},
			get onDidRegisterRuntime() {
				return extHostLanguageRuntime.onDidRegisterRuntime;
			},
		};

		const window: typeof positron.window = {
			createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: vscode.WebviewPanelOptions & vscode.WebviewOptions) {
				return extHostPreviewPanels.createPreviewPanel(extension, viewType, title, preserveFocus, options);
			}
		};

		const languages: typeof positron.languages = {
			registerStatementRangeProvider(
				selector: vscode.DocumentSelector,
				provider: positron.StatementRangeProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerStatementRangeProvider(extension, selector, provider);
			},
		};

		// --- End Positron ---

		return <typeof positron>{
			version: initData.positronVersion,
			runtime,
			window,
			languages,
			RuntimeClientType: extHostTypes.RuntimeClientType,
			RuntimeClientState: extHostTypes.RuntimeClientState,
			RuntimeExitReason: extHostTypes.RuntimeExitReason,
			LanguageRuntimeMessageType: extHostTypes.LanguageRuntimeMessageType,
			LanguageRuntimeStreamName: extHostTypes.LanguageRuntimeStreamName,
			RuntimeCodeExecutionMode: extHostTypes.RuntimeCodeExecutionMode,
			RuntimeErrorBehavior: extHostTypes.RuntimeErrorBehavior,
			LanguageRuntimeStartupBehavior: extHostTypes.LanguageRuntimeStartupBehavior,
			RuntimeOnlineState: extHostTypes.RuntimeOnlineState,
			RuntimeState: extHostTypes.RuntimeState,
			RuntimeCodeFragmentStatus: extHostTypes.RuntimeCodeFragmentStatus,
		};
	};
}
