/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostLanguageRuntime } from './extHostLanguageRuntime.js';
import type * as positron from 'positron';
import type * as vscode from 'vscode';
import { IExtHostRpcService } from '../extHostRpcService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IExtensionRegistries } from '../extHost.api.impl.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ExtHostConfigProvider } from '../extHostConfiguration.js';
import { ExtHostPositronContext } from './extHost.positron.protocol.js';
import * as extHostTypes from './extHostTypes.positron.js';
import { IExtHostInitDataService } from '../extHostInitDataService.js';
import { ExtHostPreviewPanels } from './extHostPreviewPanels.js';
import { ExtHostModalDialogs } from './extHostModalDialogs.js';
import { ExtHostContextKeyService } from './extHostContextKeyService.js';
import { ExtHostDocuments } from '../extHostDocuments.js';
import { ExtHostContext } from '../extHost.protocol.js';
import { IExtHostWorkspace } from '../extHostWorkspace.js';
import { IExtHostCommands } from '../extHostCommands.js';
import { ExtHostWebviews } from '../extHostWebview.js';
import { ExtHostLanguageFeatures } from '../extHostLanguageFeatures.js';
import { ExtHostOutputService } from '../extHostOutput.js';
import { ExtHostConsoleService } from './extHostConsoleService.js';
import { ExtHostMethods } from './extHostMethods.js';
import { ExtHostEditors } from '../extHostTextEditors.js';
import { UiFrontendRequest } from '../../../services/languageRuntime/common/positronUiComm.js';
import { ExtHostConnections } from './extHostConnections.js';
import { ExtHostAiFeatures } from './extHostAiFeatures.js';
import { IToolInvocationContext } from '../../../contrib/chat/common/languageModelToolsService.js';

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
	const extHostAiFeatures = rpcProtocol.set(ExtHostPositronContext.ExtHostAiFeatures, new ExtHostAiFeatures(rpcProtocol, extHostCommands));
	const extHostPreviewPanels = rpcProtocol.set(ExtHostPositronContext.ExtHostPreviewPanel, new ExtHostPreviewPanels(rpcProtocol, extHostWebviews, extHostWorkspace));
	const extHostModalDialogs = rpcProtocol.set(ExtHostPositronContext.ExtHostModalDialogs, new ExtHostModalDialogs(rpcProtocol));
	const extHostContextKeyService = rpcProtocol.set(ExtHostPositronContext.ExtHostContextKeyService, new ExtHostContextKeyService(rpcProtocol));
	const extHostConsoleService = rpcProtocol.set(ExtHostPositronContext.ExtHostConsoleService, new ExtHostConsoleService(rpcProtocol, extHostLogService));
	const extHostMethods = rpcProtocol.set(ExtHostPositronContext.ExtHostMethods,
		new ExtHostMethods(rpcProtocol, extHostEditors, extHostDocuments, extHostModalDialogs,
			extHostLanguageRuntime, extHostWorkspace, extHostCommands, extHostContextKeyService));
	const extHostConnections = rpcProtocol.set(ExtHostPositronContext.ExtHostConnections, new ExtHostConnections(rpcProtocol));

	return function (extension: IExtensionDescription, extensionInfo: IExtensionRegistries, configProvider: ExtHostConfigProvider): typeof positron {

		// --- Start Positron ---
		const runtime: typeof positron.runtime = {
			executeCode(languageId, code, focus, allowIncomplete, mode, errorBehavior): Thenable<boolean> {
				return extHostLanguageRuntime.executeCode(languageId, code, focus, allowIncomplete, mode, errorBehavior);
			},
			registerLanguageRuntimeManager(
				languageId: string,
				manager: positron.LanguageRuntimeManager): vscode.Disposable {
				return extHostLanguageRuntime.registerLanguageRuntimeManager(extension, languageId, manager);
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

		const connections: typeof positron.connections = {
			/**
			 * Register a connection driver that's used to generate code for connecting to a data source
			 * using the 'New Connection' dialog.
			 * @param driver The connection driver to register.
			 * @returns A disposable that can be used to unregister the driver.
			 */
			registerConnectionDriver(driver: positron.ConnectionsDriver): vscode.Disposable {
				return extHostConnections.registerConnectionDriver(driver);
			}
		};

		const ai: typeof positron.ai = {
			getCurrentPlotUri(): Thenable<string | undefined> {
				return extHostAiFeatures.getCurrentPlotUri();
			},
			showLanguageModelConfig(sources: positron.ai.LanguageModelSource[]): Thenable<positron.ai.LanguageModelConfig | undefined> {
				return extHostAiFeatures.showLanguageModelConfig(sources);
			},
			registerChatAgent(agentData: positron.ai.ChatAgentData): Thenable<vscode.Disposable> {
				return extHostAiFeatures.registerChatAgent(extension, agentData);
			},
			responseProgress(token: unknown, part: vscode.ChatResponsePart | vscode.ChatResponseTextEditPart | vscode.ChatResponseConfirmationPart): void {
				const context = token as IToolInvocationContext;
				return extHostAiFeatures.responseProgress(context, part);
			},
			getPositronChatContext(request: vscode.ChatRequest): Thenable<positron.ai.ChatContext> {
				return extHostAiFeatures.getPositronChatContext(request);
			}
		};

		// --- End Positron ---

		return <typeof positron>{
			version: initData.positronVersion,
			buildNumber: initData.positronBuildNumber,
			runtime,
			window,
			languages,
			methods,
			connections,
			ai,
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
