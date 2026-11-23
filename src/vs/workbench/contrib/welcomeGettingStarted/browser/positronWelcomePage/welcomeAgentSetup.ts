/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { POSIT_HAS_CHAT_MODELS_KEY } from '../../../positronAssistant/browser/positAssistantChat.js';
import { AI_ENABLED_KEY, MCP_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfigurationKeys.js';

/** The Posit Assistant extension. */
export const ASSISTANT_EXTENSION_ID = 'posit.assistant';

/**
 * The setting that turns the Posit Assistant chat on and off. Registered by the
 * extension, so it has no value while the extension is missing.
 */
export const ASSISTANT_ENABLED_KEY = 'assistant.enabled';

/**
 * Where Posit Assistant stands: not installed, installed but turned off, or on.
 */
export type AssistantInstallState = 'missing' | 'off' | 'on';

/**
 * A snapshot of the user's AI agent setup.
 */
export interface IAgentSetupState {
	/** Whether AI features are on at all. When off, the welcome page shows no agent setup. */
	readonly aiEnabled: boolean;
	/** Whether Posit Assistant is installed and turned on. */
	readonly assistant: AssistantInstallState;
	/** Whether Posit Assistant has at least one model it can use, which means a provider is signed in. */
	readonly providerSignedIn: boolean;
	/** Whether Positron's MCP server for external coding agents is on. */
	readonly mcpServerEnabled: boolean;
}

/**
 * Tracks the user's AI agent setup for the welcome page: whether Posit Assistant
 * is installed, whether a model provider is signed in, and whether Positron's
 * MCP server is on. Built by the editor pane, because the welcome page's React
 * tree is rebuilt whenever a walkthrough registers.
 */
export class WelcomeAgentSetup extends Disposable {
	private _assistantInstalled = false;
	private _state: IAgentSetupState;
	private readonly _onDidChange = this._register(new Emitter<IAgentSetupState>());

	/** Fires with the new setup when any part of {@link state} changes. */
	readonly onDidChange: Event<IAgentSetupState> = this._onDidChange.event;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
		super();
		this._state = this._readState();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AI_ENABLED_KEY) || e.affectsConfiguration(ASSISTANT_ENABLED_KEY) || e.affectsConfiguration(MCP_ENABLED_KEY)) {
				this._update();
			}
		}));
		const hasChatModelsKeys = new Set([POSIT_HAS_CHAT_MODELS_KEY]);
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(hasChatModelsKeys)) {
				this._update();
			}
		}));
		this._register(this._extensionService.onDidChangeExtensions(() => this._updateInstalled()));
		this._updateInstalled();
	}

	/** The current setup. */
	get state(): IAgentSetupState {
		return this._state;
	}

	private async _updateInstalled(): Promise<void> {
		this._assistantInstalled = (await this._extensionService.getExtension(ASSISTANT_EXTENSION_ID)) !== undefined;
		this._update();
	}

	private _update(): void {
		const state = this._readState();
		if (
			state.aiEnabled !== this._state.aiEnabled ||
			state.assistant !== this._state.assistant ||
			state.providerSignedIn !== this._state.providerSignedIn ||
			state.mcpServerEnabled !== this._state.mcpServerEnabled
		) {
			this._state = state;
			this._onDidChange.fire(state);
		}
	}

	private _readState(): IAgentSetupState {
		let assistant: AssistantInstallState = 'missing';
		if (this._assistantInstalled) {
			assistant = this._configurationService.getValue<boolean>(ASSISTANT_ENABLED_KEY) === false ? 'off' : 'on';
		}
		return {
			aiEnabled: this._configurationService.getValue<boolean>(AI_ENABLED_KEY) === true,
			assistant,
			providerSignedIn: this._contextKeyService.getContextKeyValue<boolean>(POSIT_HAS_CHAT_MODELS_KEY) === true,
			mcpServerEnabled: this._configurationService.getValue<boolean>(MCP_ENABLED_KEY) === true,
		};
	}
}
