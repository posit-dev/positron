/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
import { ExtHostContextKeyService } from 'vs/workbench/api/common/positron/extHostContextKeyService';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { IExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
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
	const extHostCommands = accessor.get(IExtHostCommands);
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
	const extHostDocuments: ExtHostDocuments = rpcProtocol.getRaw(ExtHostContext.ExtHostDocuments);
	const extHostLanguageRuntime = rpcProtocol.set(ExtHostPositronContext.ExtHostLanguageRuntime, new ExtHostLanguageRuntime(rpcProtocol, extHostLogService));
	const extHostPreviewPanels = rpcProtocol.set(ExtHostPositronContext.ExtHostPreviewPanel, new ExtHostPreviewPanels(rpcProtocol, extHostWebviews, extHostWorkspace));
	const extHostModalDialogs = rpcProtocol.set(ExtHostPositronContext.ExtHostModalDialogs, new ExtHostModalDialogs(rpcProtocol));
	const extHostContextKeyService = rpcProtocol.set(ExtHostPositronContext.ExtHostContextKeyService, new ExtHostContextKeyService(rpcProtocol));
	const extHostConsoleService = rpcProtocol.set(ExtHostPositronContext.ExtHostConsoleService, new ExtHostConsoleService(rpcProtocol, extHostLogService));
	const extHostMethods = rpcProtocol.set(ExtHostPositronContext.ExtHostMethods,
		new ExtHostMethods(rpcProtocol, extHostEditors, extHostDocuments, extHostModalDialogs,
			extHostLanguageRuntime, extHostWorkspace, extHostCommands, extHostContextKeyService));

	return function (extension: IExtensionDescription, extensionInfo: IExtensionRegistries, configProvider: ExtHostConfigProvider): typeof positron {

		// --- Start Positron ---
		const runtime: typeof positron.runtime = {
			executeCode(languageId, code, focus, allowIncomplete): Thenable<boolean> {
				return extHostLanguageRuntime.executeCode(languageId, code, focus, allowIncomplete);
			},
			registerLanguageRuntimeManager(
				manager: positron.LanguageRuntimeManager): vscode.Disposable {
				return extHostLanguageRuntime.registerLanguageRuntimeManager(extension, manager);
			},
			getRegisteredRuntimes(): Thenable<positron.LanguageRuntimeMetadata[]> {
				return extHostLanguageRuntime.getRegisteredRuntimes();
			},
			getPreferredRuntime(languageId: string): Thenable<positron.LanguageRuntimeMetadata> {
				return extHostLanguageRuntime.getPreferredRuntime(languageId);
			},
			getForegroundSession(): Thenable<positron.LanguageRuntimeSession | undefined> {
				return extHostLanguageRuntime.getForegroundSession();
			},
			getNotebookSession(notebookUri: vscode.Uri): Thenable<positron.LanguageRuntimeSession | undefined> {
				return extHostLanguageRuntime.getNotebookSession(notebookUri);
			},
			selectLanguageRuntime(runtimeId: string): Thenable<void> {
				return extHostLanguageRuntime.selectLanguageRuntime(runtimeId);
			},
			startLanguageRuntime(runtimeId: string,
				sessionName: string,
				notebookUri?: vscode.Uri): Thenable<positron.LanguageRuntimeSession> {

				// If a notebook document is provided, we are in notebook mode.
				const sessionMode = notebookUri ?
					extHostTypes.LanguageRuntimeSessionMode.Notebook :
					extHostTypes.LanguageRuntimeSessionMode.Console;

				// Start the language runtime.
				return extHostLanguageRuntime.startLanguageRuntime(runtimeId,
					sessionName,
					sessionMode,
					notebookUri);
			},
			restartSession(sessionId: string): Thenable<void> {
				return extHostLanguageRuntime.restartSession(sessionId);
			},
			registerClientHandler(handler: positron.RuntimeClientHandler): vscode.Disposable {
				return extHostLanguageRuntime.registerClientHandler(handler);
			},
			registerClientInstance(clientInstanceId: string): vscode.Disposable {
				/**
				 * Register a runtime client instance. Registering the instance
				 * indicates that the caller has ownership of the instance, and that
				 * messages the instance receives do not need to be forwarded to the
				 * Positron core.
				 */
				return extHostLanguageRuntime.registerClientInstance(clientInstanceId);
			},
			get onDidRegisterRuntime() {
				return extHostLanguageRuntime.onDidRegisterRuntime;
			}
		};

		const window: typeof positron.window = {
			createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: vscode.WebviewPanelOptions & vscode.WebviewOptions) {
				return extHostPreviewPanels.createPreviewPanel(extension, viewType, title, preserveFocus, options);
			},
			previewUrl(url: vscode.Uri) {
				return extHostPreviewPanels.previewUrl(extension, url);
			},
			previewHtml(path: string) {
				return extHostPreviewPanels.previewHtml(extension, path);
			},
			createRawLogOutputChannel(name: string): vscode.OutputChannel {
				return extHostOutputService.createRawLogOutputChannel(name, extension);
			},
			showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Thenable<boolean> {
				return extHostModalDialogs.showSimpleModalDialogPrompt(title, message, okButtonTitle, cancelButtonTitle);
			},
			showSimpleModalDialogMessage(title: string, message: string, okButtonTitle?: string): Thenable<null> {
				return extHostModalDialogs.showSimpleModalDialogMessage(title, message, okButtonTitle);
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
			showDialog(title: string, message: string): Thenable<null> {
				return extHostMethods.showDialog(title, message);
			},
			showQuestion(title: string, message: string, okButtonTitle: string, cancelButtonTitle: string): Thenable<boolean> {
				return extHostMethods.showQuestion(title, message, okButtonTitle, cancelButtonTitle);
			},
		};

		// --- End Positron ---

		return <typeof positron>{
			version: initData.positronVersion,
			buildNumber: initData.positronBuildNumber,
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
			LanguageRuntimeSessionMode: extHostTypes.LanguageRuntimeSessionMode,
			RuntimeCodeExecutionMode: extHostTypes.RuntimeCodeExecutionMode,
			RuntimeErrorBehavior: extHostTypes.RuntimeErrorBehavior,
			LanguageRuntimeStartupBehavior: extHostTypes.LanguageRuntimeStartupBehavior,
			LanguageRuntimeSessionLocation: extHostTypes.LanguageRuntimeSessionLocation,
			RuntimeOnlineState: extHostTypes.RuntimeOnlineState,
			RuntimeState: extHostTypes.RuntimeState,
			RuntimeCodeFragmentStatus: extHostTypes.RuntimeCodeFragmentStatus,
		};
	};
}
