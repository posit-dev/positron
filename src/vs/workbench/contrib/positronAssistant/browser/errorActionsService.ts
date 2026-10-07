/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ERROR_ACTIONS_TARGET_KEY, ErrorActionKind, IErrorActionContext, IErrorActionHandler, IErrorActionsService, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';

/** Name of Posit Assistant's implementation, the setting's default. */
export const POSIT_ASSISTANT_ERROR_ACTIONS_LABEL = localize('positron.errorActions.target.positAssistant', "Posit Assistant");

/**
 * Build the ai.errorActions.target setting with one option per registered
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
			[ERROR_ACTIONS_TARGET_KEY]: {
				type: 'string',
				default: POSIT_ASSISTANT_ERROR_ACTIONS_ID,
				enum: [POSIT_ASSISTANT_ERROR_ACTIONS_ID, ...others.map(handler => handler.id)],
				enumItemLabels: [POSIT_ASSISTANT_ERROR_ACTIONS_LABEL, ...others.map(handler => handler.label)],
				description: localize(
					'positron.errorActions.target',
					"The assistant to use when you select Fix or Explain on an error in the Console, a notebook, or a Quarto document."
				),
				scope: ConfigurationScope.WINDOW,
			},
		},
	};
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

/** The currently registered ai.errorActions.target setting node. */
let configurationNode = getConfigurationNode([]);
configurationRegistry.registerConfiguration(configurationNode);

export class ErrorActionsService extends Disposable implements IErrorActionsService {
	declare readonly _serviceBrand: undefined;

	/** Fires when the registered implementations or the configured one change. */
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** Registered implementations, in registration order. */
	private readonly _registered: IErrorActionHandler[] = [];

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ERROR_ACTIONS_TARGET_KEY)) {
				this._onDidChange.fire();
			}
		}));
	}

	register(handler: IErrorActionHandler): IDisposable {
		if (this._registered.some(registered => registered.id === handler.id)) {
			this._logService.error(`An error action handler with the id '${handler.id}' is already registered`);
			return Disposable.None;
		}

		this._registered.push(handler);
		this._update();
		return toDisposable(() => {
			const index = this._registered.indexOf(handler);
			if (index !== -1) {
				this._registered.splice(index, 1);
				this._update();
			}
		});
	}

	getConfigured(): IErrorActionHandler | undefined {
		const id = this._configurationService.getValue<string>(ERROR_ACTIONS_TARGET_KEY);
		return this._registered.find(handler => handler.id === id)
			?? this._registered.find(handler => handler.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID);
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

	/** Refresh the setting's options and notify listeners. */
	private _update(): void {
		const node = getConfigurationNode(this._registered);
		configurationRegistry.updateConfigurations({ add: [node], remove: [configurationNode] });
		configurationNode = node;
		this._onDidChange.fire();
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
