/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
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

/**
 * Build the ai.errorActions.agent setting with one option per registered
 * implementation, always starting with Posit Assistant, the default.
 * Re-registered whenever registrations change so the Settings editor dropdown
 * stays current.
 */
function getConfigurationNode(registered: readonly IErrorActionHandler[]): IConfigurationNode {
	const others = registered.filter(handler => handler.id !== POSIT_ASSISTANT_ERROR_ACTIONS_ID);
	return {
		id: 'ai',
		order: 5,
		title: localize('positron.ai.title', "AI"),
		type: 'object',
		properties: {
			[ERROR_ACTIONS_AGENT_KEY]: {
				type: 'string',
				default: POSIT_ASSISTANT_ERROR_ACTIONS_ID,
				enum: [POSIT_ASSISTANT_ERROR_ACTIONS_ID, ...others.map(handler => handler.id)],
				enumItemLabels: [POSIT_ASSISTANT_ERROR_ACTIONS_LABEL, ...others.map(handler => handler.label)],
				description: localize(
					'positron.errorActions.agent',
					"The agent that fixes and explains errors in the Console, notebooks, and Quarto documents."
				),
				scope: ConfigurationScope.WINDOW,
			},
		},
	};
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

/** The currently registered ai.errorActions.agent setting node. */
let configurationNode = getConfigurationNode([]);
configurationRegistry.registerConfiguration(configurationNode);

/** A registered implementation, with whether it can continue a chat. */
interface IRegisteredHandler {
	readonly handler: IErrorActionHandler;
	canContinueChat: boolean;
}

export class ErrorActionsService extends Disposable implements IErrorActionsService {
	declare readonly _serviceBrand: undefined;

	/**
	 * Fires when the registered implementations, the configured one, or
	 * whether a registered one is enabled or can continue a chat change.
	 */
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** Registered implementations, in registration order. */
	private readonly _registered: IRegisteredHandler[] = [];

	/** Context keys read by the registered implementations' `when` expressions. */
	private _whenKeys = new Set<string>();

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

		// Handlers' `when` expressions can change which one is configured.
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (this._whenKeys.size > 0 && e.affectsSome(this._whenKeys)) {
				this._onDidChange.fire();
			}
		}));
	}

	register(handler: IErrorActionHandler): IErrorActionHandlerRegistration {
		if (this._registered.some(registered => registered.handler.id === handler.id)) {
			this._logService.error(`An error action handler with the id '${handler.id}' is already registered`);
			return { setCanContinueChat: () => { }, dispose: () => { } };
		}

		const registered: IRegisteredHandler = { handler, canContinueChat: true };
		this._registered.push(registered);
		this._update();
		return {
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
		const enabled = this._registered
			.map(registered => registered.handler)
			.filter(handler => !handler.when || this._contextKeyService.contextMatchesRules(handler.when));
		return enabled.find(handler => handler.id === id)
			?? enabled.find(handler => handler.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID);
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

	/** Refresh the setting's options and the watched context keys, and notify listeners. */
	private _update(): void {
		const handlers = this._registered.map(registered => registered.handler);
		this._whenKeys = new Set(handlers.flatMap(handler => handler.when?.keys() ?? []));
		const node = getConfigurationNode(handlers);
		configurationRegistry.updateConfigurations({ add: [node], remove: [configurationNode] });
		configurationNode = node;
		this._onDidChange.fire();
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
