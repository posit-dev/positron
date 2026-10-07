/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { equals } from '../../../../base/common/arrays.js';
import { escapeMarkdownSyntaxTokens } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ERROR_ACTIONS_AGENT_KEY, ErrorActionKind, IErrorActionContext, IErrorActionHandler, IErrorActionHandlerRegistration, IErrorActionsService, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';

/** Name of Posit Assistant's implementation, the setting's default. */
export const POSIT_ASSISTANT_ERROR_ACTIONS_LABEL = localize('positron.errorActions.agent.positAssistant', "Posit Assistant");

/** An option in the ai.errorActions.agent setting. */
interface IAgentOption {
	readonly id: string;
	readonly label: string;
	readonly isAvailable: boolean;
	readonly unavailableReason?: string;
}

/**
 * Build the ai.errorActions.agent setting with one option per registered
 * implementation, always starting with Posit Assistant, the default. Options
 * that can't take errors at the moment are marked unavailable, with the reason,
 * and when the selected one is, a note under the setting says what happens
 * instead. Re-registered whenever these change so the Settings editor stays
 * current.
 * @param selectedId The setting's value.
 */
function getConfigurationNode(options: readonly IAgentOption[], selectedId: string | undefined): IConfigurationNode {
	const positAssistant = options.find(option => option.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID)
		?? { id: POSIT_ASSISTANT_ERROR_ACTIONS_ID, label: POSIT_ASSISTANT_ERROR_ACTIONS_LABEL, isAvailable: true };
	const allOptions = [positAssistant, ...options.filter(option => option !== positAssistant)];
	const description = localize(
		'positron.errorActions.agent',
		"The agent that Fix and Explain send errors to, in the Console, notebooks, and Quarto documents."
	);
	const note = getSelectionNote(allOptions, selectedId);
	return {
		id: 'ai',
		order: 5,
		title: localize('positron.ai.title', "AI"),
		type: 'object',
		properties: {
			[ERROR_ACTIONS_AGENT_KEY]: {
				type: 'string',
				default: POSIT_ASSISTANT_ERROR_ACTIONS_ID,
				enum: allOptions.map(option => option.id),
				enumItemLabels: allOptions.map(option => option.isAvailable
					? option.label
					: localize('positron.errorActions.agent.unavailableLabel', "{0} (unavailable)", option.label)),
				enumDescriptions: allOptions.map(option => getOptionDescription(option)),
				markdownDescription: note ? `${description}\n\n${note}` : description,
				scope: ConfigurationScope.WINDOW,
			},
		},
	};
}

/**
 * A markdown note for under the setting when the selected agent can't take
 * errors: why, and what Fix and Explain do instead.
 * @param options The setting's options, starting with Posit Assistant.
 * @returns The note, or undefined when the selected agent can take errors.
 */
function getSelectionNote(options: readonly IAgentOption[], selectedId: string | undefined): string | undefined {
	const selected = options.find(option => option.id === selectedId);
	if (!selectedId || selected?.isAvailable) {
		return undefined;
	}
	const positAssistant = options[0];
	const fallback = selected !== positAssistant && positAssistant.isAvailable
		? localize('positron.errorActions.agent.fallbackNote', "The default, Posit Assistant, is used instead.")
		: localize('positron.errorActions.agent.hiddenNote', "Fix and Explain are hidden until an agent is available.");
	if (!selected) {
		return localize('positron.errorActions.agent.notInstalledNote', "**The selected agent, `{0}`, isn't installed.** {1}", selectedId, fallback);
	}
	const reason = selected.unavailableReason ?? localize('positron.errorActions.agent.unavailable', "Not available right now.");
	return localize(
		'positron.errorActions.agent.unavailableNote',
		"**{0} is unavailable.** {1} {2}",
		escapeMarkdownSyntaxTokens(selected.label),
		escapeMarkdownSyntaxTokens(reason),
		fallback
	);
}

/** Describe an option in the setting's dropdown: why it's unavailable, if it is. */
function getOptionDescription(option: IAgentOption): string {
	if (option.isAvailable) {
		return '';
	}
	const reason = option.unavailableReason ?? localize('positron.errorActions.agent.unavailable', "Not available right now.");
	if (option.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID) {
		return reason;
	}
	return localize('positron.errorActions.agent.unavailableFallback', "{0} The default, Posit Assistant, is used instead.", reason);
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

/** The currently registered ai.errorActions.agent setting node. */
let configurationNode = getConfigurationNode([], undefined);
configurationRegistry.registerConfiguration(configurationNode);

/** A registered implementation, with why it can't take errors and whether it can continue a chat. */
interface IRegisteredHandler {
	readonly handler: IErrorActionHandler;
	unavailableReason?: string;
	canContinueChat: boolean;
}

export class ErrorActionsService extends Disposable implements IErrorActionsService {
	declare readonly _serviceBrand: undefined;

	/**
	 * Fires when the registered implementations, the configured one, or
	 * whether a registered one can take errors or continue a chat change.
	 */
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** Registered implementations, in registration order. */
	private readonly _registered: IRegisteredHandler[] = [];

	/** Context keys read by the registered implementations' `when` expressions. */
	private _whenKeys = new Set<string>();

	/** The setting's options, as last registered, to skip identical updates. */
	private _options: readonly IAgentOption[] = [];

	/** The setting's value when it was last registered, to skip identical updates. */
	private _selectedId: string | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ERROR_ACTIONS_AGENT_KEY)) {
				this._updateSetting();
				this._onDidChange.fire();
			}
		}));

		// Handlers' `when` expressions can change which one is configured and
		// which options are available.
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (this._whenKeys.size > 0 && e.affectsSome(this._whenKeys)) {
				this._updateSetting();
				this._onDidChange.fire();
			}
		}));
	}

	register(handler: IErrorActionHandler): IErrorActionHandlerRegistration {
		if (this._registered.some(registered => registered.handler.id === handler.id)) {
			this._logService.error(`An error action handler with the id '${handler.id}' is already registered`);
			return { setUnavailableReason: () => { }, setCanContinueChat: () => { }, dispose: () => { } };
		}

		const registered: IRegisteredHandler = { handler, canContinueChat: true };
		this._registered.push(registered);
		this._update();
		return {
			setUnavailableReason: reason => {
				registered.unavailableReason = reason;
				this._updateSetting();
			},
			setCanContinueChat: canContinueChat => {
				if (canContinueChat !== registered.canContinueChat) {
					registered.canContinueChat = canContinueChat;
					this._onDidChange.fire();
				}
			},
			dispose: () => {
				const index = this._registered.indexOf(registered);
				if (index !== -1) {
					this._registered.splice(index, 1);
					this._update();
				}
			},
		};
	}

	getConfigured(): IErrorActionHandler | undefined {
		const id = this._configurationService.getValue<string>(ERROR_ACTIONS_AGENT_KEY);
		const available = this._registered.map(registered => registered.handler).filter(handler => this._isAvailable(handler));
		return available.find(handler => handler.id === id)
			?? available.find(handler => handler.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID);
	}

	canContinueChat(handler: IErrorActionHandler): boolean {
		return this._registered.find(registered => registered.handler === handler)?.canContinueChat ?? true;
	}

	async run(handler: IErrorActionHandler, kind: ErrorActionKind, context: IErrorActionContext): Promise<void> {
		try {
			await handler.run(kind, context, CancellationToken.None);
		} catch (error) {
			this._logService.error(`Failed to send the error to ${handler.label}`, error);
			this._notificationService.error(
				localize(
					'positron.errorActions.runFailed',
					"Could not send the error to {0}: {1}",
					handler.label,
					toErrorMessage(error)
				)
			);
		}
	}

	/** Whether a handler's `when` holds, so it can take errors. */
	private _isAvailable(handler: IErrorActionHandler): boolean {
		return !handler.when || this._contextKeyService.contextMatchesRules(handler.when);
	}

	/** Refresh the watched context keys and the setting, and notify listeners. */
	private _update(): void {
		this._whenKeys = new Set(this._registered.flatMap(registered => registered.handler.when?.keys() ?? []));
		this._updateSetting();
		this._onDidChange.fire();
	}

	/** Re-register the setting if its options or value changed. */
	private _updateSetting(): void {
		const options = this._registered.map(({ handler, unavailableReason }): IAgentOption =>
			({ id: handler.id, label: handler.label, isAvailable: this._isAvailable(handler), unavailableReason }));
		const selectedId = this._configurationService.getValue<string>(ERROR_ACTIONS_AGENT_KEY);
		if (selectedId === this._selectedId && equals(options, this._options, (a, b) =>
			a.id === b.id && a.label === b.label && a.isAvailable === b.isAvailable && a.unavailableReason === b.unavailableReason)) {
			return;
		}
		this._options = options;
		this._selectedId = selectedId;
		const node = getConfigurationNode(options, selectedId);
		configurationRegistry.updateConfigurations({ add: [node], remove: [configurationNode] });
		configurationNode = node;
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
