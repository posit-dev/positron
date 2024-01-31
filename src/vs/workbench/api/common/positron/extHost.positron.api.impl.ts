/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostLanguageRuntime } from 'vs/workbench/api/common/positron/extHostLanguageRuntime';
import type * as positron from 'positron';
import type * as vscode from 'vscode';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ILogService } from 'vs/platform/log/common/log';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionRegistries } from 'vs/workbench/api/common/extHost.api.impl';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtHostConfigProvider } from 'vs/workbench/api/common/extHostConfiguration';
import { ExtHostPositronContext } from 'vs/workbench/api/common/positron/extHost.positron.protocol';
import * as extHostTypes from 'vs/workbench/api/common/positron/extHostTypes.positron';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { ExtHostPreviewPanels } from 'vs/workbench/api/common/positron/extHostPreviewPanels';
import { ExtHostModalDialogs } from 'vs/workbench/api/common/positron/extHostModalDialogs';
import { ExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { ExtHostWebviews } from 'vs/workbench/api/common/extHostWebview';
import { ExtHostLanguageFeatures } from 'vs/workbench/api/common/extHostLanguageFeatures';
import { ExtHostOutputService } from 'vs/workbench/api/common/extHostOutput';
import { ExtHostConsoleService } from 'vs/workbench/api/common/positron/extHostConsoleService';
import { ExtHostMethods } from './extHostMethods';
import { ExtHostEditors } from '../extHostTextEditors';
import { UiFrontendRequest } from 'vs/workbench/services/languageRuntime/common/positronUiComm';

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
	const extHostLogService = accessor.get(ILogService);

	// Retrieve the raw `ExtHostWebViews` object from the rpcProtocol; this
	// object is needed to create webviews, and was previously created in
	// `createApiFactoryAndRegisterActors` when VS Code's API factory was
	// created earlier.
	//
	// The `getRaw` method is a Positron extension to the `rpcProtocol` that
	// allows us to retrieve the raw actor object so that the Positron API and
	// VS Code API can share a single instance of for instance `ExtHostWebViews`,
	// which is necessary since the instance effectively needs to be a singleton.
	const extHostWebviews: ExtHostWebviews = rpcProtocol.getRaw(ExtHostContext.ExtHostWebviews);
	const extHostOutputService: ExtHostOutputService = rpcProtocol.getRaw(ExtHostContext.ExtHostOutputService);
	const extHostLanguageFeatures: ExtHostLanguageFeatures =
		rpcProtocol.getRaw(ExtHostContext.ExtHostLanguageFeatures);
	const extHostEditors: ExtHostEditors = rpcProtocol.getRaw(ExtHostContext.ExtHostEditors);

	const extHostLanguageRuntime = rpcProtocol.set(ExtHostPositronContext.ExtHostLanguageRuntime, new ExtHostLanguageRuntime(rpcProtocol));
	const extHostPreviewPanels = rpcProtocol.set(ExtHostPositronContext.ExtHostPreviewPanel, new ExtHostPreviewPanels(rpcProtocol, extHostWebviews, extHostWorkspace));
	const extHostModalDialogs = rpcProtocol.set(ExtHostPositronContext.ExtHostModalDialogs, new ExtHostModalDialogs(rpcProtocol));
	const extHostConsoleService = rpcProtocol.set(ExtHostPositronContext.ExtHostConsoleService, new ExtHostConsoleService(rpcProtocol, extHostLogService));
	const extHostMethods = rpcProtocol.set(ExtHostPositronContext.ExtHostMethods, new ExtHostMethods(rpcProtocol, extHostEditors));

	return function (extension: IExtensionDescription, extensionInfo: IExtensionRegistries, configProvider: ExtHostConfigProvider): typeof positron {

		// --- Start Positron ---
		const runtime: typeof positron.runtime = {
			executeCode(languageId, code, focus, skipChecks): Thenable<boolean> {
				return extHostLanguageRuntime.executeCode(languageId, code, focus, skipChecks);
			},
			registerLanguageRuntime(runtime: positron.LanguageRuntime): vscode.Disposable {
				return extHostLanguageRuntime.registerLanguageRuntime(extension, runtime);
			},
			registerLanguageRuntimeDiscoverer(languageId: string, discoverer: positron.LanguageRuntimeDiscoverer): void {
				return extHostLanguageRuntime.registerLanguageRuntimeDiscoverer(extension, languageId, discoverer);
			},
			registerLanguageRuntimeProvider(languageId: string, provider: positron.LanguageRuntimeProvider): void {
				return extHostLanguageRuntime.registerLanguageRuntimeProvider(extension, languageId, provider);
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
			}
		};

		const window: typeof positron.window = {
			createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: vscode.WebviewPanelOptions & vscode.WebviewOptions) {
				return extHostPreviewPanels.createPreviewPanel(extension, viewType, title, preserveFocus, options);
			},
			createRawLogOutputChannel(name: string): vscode.OutputChannel {
				return extHostOutputService.createRawLogOutputChannel(name, extension);
			},
			showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Thenable<boolean> {
				return extHostModalDialogs.showSimpleModalDialogPrompt(title, message, okButtonTitle, cancelButtonTitle);
			},
			getConsoleForLanguage(id: string) {
				return extHostConsoleService.getConsoleForLanguage(id);
			},
			get onDidChangeConsoleWidth() {
				return extHostConsoleService.onDidChangeConsoleWidth;
			},
			getConsoleWidth(): Thenable<number> {
				return extHostConsoleService.getConsoleWidth();
			}
		};

		const languages: typeof positron.languages = {
			registerStatementRangeProvider(
				selector: vscode.DocumentSelector,
				provider: positron.StatementRangeProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerStatementRangeProvider(extension, selector, provider);
			},
			registerHelpTopicProvider(
				selector: vscode.DocumentSelector,
				provider: positron.HelpTopicProvider): vscode.Disposable {
				return extHostLanguageFeatures.registerHelpTopicProvider(extension, selector, provider);
			}
		};

		const methods: typeof positron.methods = {
			// This takes a string to avoid making `positron.d.ts` depend on the UI comm types
			call(method: string, params: Record<string, any>): Thenable<any> {
				return extHostMethods.call(method as UiFrontendRequest, params);
			},
			lastActiveEditorContext(): Thenable<positron.EditorContext | null> {
				return extHostMethods.lastActiveEditorContext();
			},
		};

		// --- End Positron ---

		return <typeof positron>{
			version: initData.positronVersion,
			runtime,
			window,
			languages,
			methods,
			PositronOutputLocation: extHostTypes.PositronOutputLocation,
			RuntimeClientType: extHostTypes.RuntimeClientType,
			RuntimeClientState: extHostTypes.RuntimeClientState,
			RuntimeExitReason: extHostTypes.RuntimeExitReason,
			RuntimeMethodErrorCode: extHostTypes.RuntimeMethodErrorCode,
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
