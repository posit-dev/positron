/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type * as positron from 'positron';

import { ChatRequestEditorData, Disposable } from '../extHostTypes.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import * as typeConvert from '../extHostTypeConverters.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { IChatRequestReferenceSession } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IExtHostWorkspace } from '../extHostWorkspace.js';
import { getEnabledTools as filterEnabledTools } from './positronToolFilter.js';
import { URI } from '../../../../base/common/uri.js';
import { assertNever } from '../../../../base/common/assert.js';
import { ErrorAction, IErrorActionContext } from '../../../contrib/positronAssistant/common/errorAction.js';
import { POSIT_ASSISTANT_ERROR_ACTION_HANDLER_ID } from '../../../contrib/positronAssistant/common/positronAIConfigurationKeys.js';

export class ExtHostAiFeatures implements extHostProtocol.ExtHostAiFeaturesShape {

	private readonly _proxy: extHostProtocol.MainThreadAiFeaturesShape;
	private readonly _disposables: DisposableStore = new DisposableStore();

	/** Registered error action handlers and their ids, by the handle the main thread knows them by. */
	private readonly _errorActionHandlersByHandle = new Map<number, { readonly id: string; readonly handler: positron.ai.ErrorActionHandler }>();

	/** Handle for the next error action handler registration. */
	private _nextErrorActionHandlerHandle = 0;
	private readonly _onDidChangeProviderEnablementEmitter = this._disposables.add(new Emitter<{ id: string; enabled: boolean }>());
	private readonly _onDidChangeAgentSkillRootsEmitter = this._disposables.add(new Emitter<void>());

	readonly onDidChangeProviderEnablement = this._onDidChangeProviderEnablementEmitter.event;
	readonly onDidChangeAgentSkillRoots = this._onDidChangeAgentSkillRootsEmitter.event;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _extHostWorkspace: IExtHostWorkspace,
	) {
		// Trigger creation of proxy to main thread
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadAiFeatures);
	}

	/**
	 * Filters a chat request's tools down to those Positron considers enabled.
	 * Runs synchronously in the extension host; used by chat clients such as
	 * Copilot Chat.
	 */
	getEnabledTools(request: vscode.ChatRequest, tools: readonly vscode.LanguageModelToolInformation[]): string[] {
		const isWorkspaceOpen = (this._extHostWorkspace.getWorkspaceFolders()?.length ?? 0) > 0;
		return filterEnabledTools(request, tools, isWorkspaceOpen);
	}

	registerErrorActionHandler(id: string, label: string, handler: positron.ai.ErrorActionHandler, metadata?: positron.ai.ErrorActionHandlerMetadata): vscode.Disposable {
		// Refuse what this extension host knows about, as `registerCommand` does.
		// The main thread also refuses ids taken in another extension host, with
		// a logged error; unregistering a refused handle does nothing.
		if (id === POSIT_ASSISTANT_ERROR_ACTION_HANDLER_ID) {
			throw new Error(`The error action handler id '${id}' is reserved for Positron`);
		}
		for (const registration of this._errorActionHandlersByHandle.values()) {
			if (registration.id === id) {
				throw new Error(`An error action handler with the id '${id}' is already registered`);
			}
		}
		const handle = this._nextErrorActionHandlerHandle++;
		this._errorActionHandlersByHandle.set(handle, { id, handler });
		this._proxy.$registerErrorActionHandler(handle, id, label, metadata?.supportsChatContinuation === true);
		return new Disposable(() => {
			if (this._errorActionHandlersByHandle.delete(handle)) {
				this._proxy.$unregisterErrorActionHandler(handle);
			}
		});
	}

	async $askErrorActionHandler(handle: number, action: ErrorAction, context: IErrorActionContext, continueChat: boolean): Promise<void> {
		const registration = this._errorActionHandlersByHandle.get(handle);
		if (!registration) {
			throw new Error(`No error action handler is registered with the handle ${handle}`);
		}
		await registration.handler.ask(action, reviveErrorActionContext(context), { continueChat });
	}

	$onDidChangeProviderEnablement(id: string, enabled: boolean): void {
		this._onDidChangeProviderEnablementEmitter.fire({ id, enabled });
	}

	async getCurrentPlotUri(): Promise<string | undefined> {
		return this._proxy.$getCurrentPlotUri();
	}

	async generateAssistantPrompt(request: vscode.ChatRequest): Promise<string> {
		// Extract only the serializable parts of the live request that the
		// prompt needs, then let the main thread assemble and render it.
		const selectionIsEmpty = request.location2 instanceof ChatRequestEditorData
			? request.location2.selection?.isEmpty
			: undefined;

		const referenceSessions: IChatRequestReferenceSession[] = [];
		for (const reference of request.references ?? []) {
			const value = reference.value as { activeSession?: unknown; variables?: unknown };
			if (value.activeSession) {
				referenceSessions.push({ activeSession: value.activeSession, variables: value.variables });
			}
		}

		return this._proxy.$generateAssistantPrompt({
			location: typeConvert.ChatLocation.from(request.location),
			selectionIsEmpty,
			referenceSessions,
		});
	}

	async isProviderEnabled(id: string): Promise<boolean> {
		return this._proxy.$isProviderEnabled(id);
	}

	async getProviderBaseUrl(id: string): Promise<string | undefined> {
		return this._proxy.$getProviderBaseUrl(id);
	}

	async getAgentAllowedCommands(options?: { includeDisabled?: boolean }): Promise<extHostProtocol.ISerializedAgentCommand[]> {
		return this._proxy.$getAgentAllowedCommands(options);
	}

	/**
	 * Skill roots registered at runtime via {@link registerAgentSkillRoot}.
	 * Held in the extension host because both the registering extension and the
	 * reading consumer (the assistant) live here, so no main-thread round-trip
	 * is needed and registration is observable immediately.
	 */
	private readonly _registeredSkillRoots = new Set<string>();

	/**
	 * Filesystem roots holding the agent skills available to this Positron
	 * build, registered at runtime via {@link registerAgentSkillRoot}. Empty
	 * when none are registered.
	 */
	async getAgentSkillRoots(): Promise<string[]> {
		return [...this._registeredSkillRoots];
	}

	registerAgentSkillRoot(root: string): Disposable {
		// Fire only on a real change so a consumer doesn't re-scan for a
		// duplicate registration. Roots often land after the reading extension
		// has already taken its first snapshot, so the event is how it learns.
		if (!this._registeredSkillRoots.has(root)) {
			this._registeredSkillRoots.add(root);
			this._onDidChangeAgentSkillRootsEmitter.fire();
		}
		return new Disposable(() => {
			if (this._registeredSkillRoots.delete(root)) {
				this._onDidChangeAgentSkillRootsEmitter.fire();
			}
		});
	}

	async validateAndExecuteCommand(
		commandId: string,
		args: unknown[] | undefined,
	): Promise<extHostProtocol.ISerializedValidateAndExecuteCommandResult> {
		return this._proxy.$validateAndExecuteCommand(commandId, args);
	}

}

/** Convert an error's context from the main thread, reviving its URI. */
function reviveErrorActionContext(context: IErrorActionContext): positron.ai.ErrorActionContext {
	switch (context.kind) {
		case 'console':
			return context;
		case 'notebook':
		case 'quarto':
			return { ...context, uri: URI.revive(context.uri) };
		default:
			assertNever(context);
	}
}
