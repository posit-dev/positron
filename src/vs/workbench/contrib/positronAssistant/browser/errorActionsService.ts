/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { equals } from '../../../../base/common/arrays.js';
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
 * that can't take errors at the moment are marked unavailable, with the reason.
 * Re-registered whenever the options change so the Settings editor dropdown
 * stays current.
 */
function getConfigurationNode(options: readonly IAgentOption[]): IConfigurationNode {
	const positAssistant = options.find(option => option.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID)
		?? { id: POSIT_ASSISTANT_ERROR_ACTIONS_ID, label: POSIT_ASSISTANT_ERROR_ACTIONS_LABEL, isAvailable: true };
	const allOptions = [positAssistant, ...options.filter(option => option !== positAssistant)];
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
				description: localize(
					'positron.errorActions.agent',
					"The agent that Fix and Explain send errors to, in the Console, notebooks, and Quarto documents."
				),
				scope: ConfigurationScope.WINDOW,
			},
		},
	};
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
	return localize('positron.errorActions.agent.unavailableFallback', "{0} Until it's available, Fix and Explain use Posit Assistant.", reason);
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

/** The currently registered ai.errorActions.agent setting node. */
let configurationNode = getConfigurationNode([]);
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

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ERROR_ACTIONS_AGENT_KEY)) {
				this._onDidChange.fire();
			}
		}));

		// Handlers' `when` expressions can change which one is configured and
		// which options are available.
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (this._whenKeys.size > 0 && e.affectsSome(this._whenKeys)) {
				this._updateOptions();
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
				this._updateOptions();
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

	/** Refresh the watched context keys and the setting's options, and notify listeners. */
	private _update(): void {
		this._whenKeys = new Set(this._registered.flatMap(registered => registered.handler.when?.keys() ?? []));
		this._updateOptions();
		this._onDidChange.fire();
	}

	/** Re-register the setting if its options changed. */
	private _updateOptions(): void {
		const options = this._registered.map(({ handler, unavailableReason }): IAgentOption =>
			({ id: handler.id, label: handler.label, isAvailable: this._isAvailable(handler), unavailableReason }));
		if (equals(options, this._options, (a, b) =>
			a.id === b.id && a.label === b.label && a.isAvailable === b.isAvailable && a.unavailableReason === b.unavailableReason)) {
			return;
		}
		this._options = options;
		const node = getConfigurationNode(options);
		configurationRegistry.updateConfigurations({ add: [node], remove: [configurationNode] });
		configurationNode = node;
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
