/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { IJSONSchema, TypeFromJsonSchema } from '../../../../base/common/jsonSchema.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfigurationKeys.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ExtensionsRegistry, IExtensionPointUser } from '../../../services/extensions/common/extensionsRegistry.js';
import { ERROR_ACTIONS_TARGET_KEY, IErrorActionRequest, IErrorActionTarget, IErrorActionTargetService, POSIT_ASSISTANT_TARGET_ID } from '../common/errorActionTargets.js';

const errorActionTargetSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['id', 'label', 'command'],
	properties: {
		id: {
			type: 'string',
			description: localize('positron.errorActionTargets.id', "Identifier of the target, used as the value of the `{0}` setting.", ERROR_ACTIONS_TARGET_KEY),
		},
		label: {
			type: 'string',
			description: localize('positron.errorActionTargets.label', "Name of the target shown in the Settings editor."),
		},
		description: {
			type: 'string',
			description: localize('positron.errorActionTargets.description', "Description of the target shown in the Settings editor."),
		},
		command: {
			type: 'string',
			description: localize('positron.errorActionTargets.command', "Command to run when the user presses Fix or Explain. It receives an object with `action`, `prompt`, `context`, and `contextName` properties."),
		},
		requiresExtension: {
			type: 'string',
			description: localize('positron.errorActionTargets.requiresExtension', "Identifier of an extension that must be installed and enabled for the target to be offered."),
		},
	},
} as const satisfies IJSONSchema;

type IRawErrorActionTargetContribution = TypeFromJsonSchema<typeof errorActionTargetSchema>;

const errorActionTargetsExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IRawErrorActionTargetContribution[]>({
	extensionPoint: 'errorActionTargets',
	jsonSchema: {
		description: localize('positron.errorActionTargets', "Contributes a target for the Fix and Explain actions on console, notebook, and Quarto errors."),
		type: 'array',
		items: errorActionTargetSchema,
	},
});

/**
 * Build the ai.errorActions.target setting with one option per available
 * target. Re-registered whenever the targets change so the Settings editor
 * dropdown stays current.
 */
function getConfigurationNode(targets: readonly IErrorActionTarget[]): IConfigurationNode {
	return {
		id: 'ai',
		order: 5,
		title: localize('positron.ai.title', "AI"),
		type: 'object',
		properties: {
			[ERROR_ACTIONS_TARGET_KEY]: {
				type: 'string',
				default: POSIT_ASSISTANT_TARGET_ID,
				enum: [POSIT_ASSISTANT_TARGET_ID, ...targets.map(target => target.id)],
				enumItemLabels: [localize('positron.errorActions.target.positAssistant', "Posit Assistant"), ...targets.map(target => target.label)],
				enumDescriptions: [
					localize('positron.errorActions.target.positAssistantDescription', "Send errors to Posit Assistant."),
					...targets.map(target => target.description ?? ''),
				],
				markdownDescription: localize(
					'positron.errorActions.target',
					"Where the Fix and Explain actions on console, notebook, and Quarto errors send the error. Options other than Posit Assistant are contributed by extensions and only appear when available. Requires `#{0}#`.",
					AI_ENABLED_KEY
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

export class ErrorActionTargetService extends Disposable implements IErrorActionTargetService {
	declare readonly _serviceBrand: undefined;

	/** Fires when the contributed targets or the configured target change. */
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** All contributed targets, before filtering on required extensions. */
	private _contributedTargets: IErrorActionTarget[] = [];

	/** Contributed targets whose required extension is available. */
	private _targets: IErrorActionTarget[] = [];

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._register(errorActionTargetsExtensionPoint.setHandler(extensions => {
			this._contributedTargets = extensions.flatMap(extension => this._readContribution(extension));
			this._updateTargets();
		}));

		// A target's required extension can be installed, enabled, or removed
		// without the contributing extension changing.
		this._register(this._extensionService.onDidChangeExtensions(() => this._updateTargets()));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ERROR_ACTIONS_TARGET_KEY)) {
				this._onDidChange.fire();
			}
		}));

	}

	get targets(): readonly IErrorActionTarget[] {
		return this._targets;
	}

	getConfiguredTarget(): IErrorActionTarget | undefined {
		const id = this._configurationService.getValue<string>(ERROR_ACTIONS_TARGET_KEY);
		return this._targets.find(target => target.id === id);
	}

	async run(target: IErrorActionTarget, request: IErrorActionRequest): Promise<void> {
		try {
			await this._commandService.executeCommand(target.command, request);
		} catch (error) {
			this._logService.error(`Failed to send error to ${target.label}`, error);
			this._notificationService.error(
				localize(
					'positron.errorActionTargets.runFailed',
					"Could not send the error to {0}: {1}",
					target.label,
					toErrorMessage(error)
				)
			);
		}
	}

	/** Validate one extension's contribution, logging and skipping bad entries. */
	private _readContribution(extension: IExtensionPointUser<IRawErrorActionTargetContribution[]>): IErrorActionTarget[] {
		const targets: IErrorActionTarget[] = [];
		for (const raw of extension.value) {
			if (!raw.id || !raw.label || !raw.command) {
				extension.collector.error(localize('positron.errorActionTargets.invalid', "Error action targets require `id`, `label`, and `command`."));
				continue;
			}
			if (raw.id === POSIT_ASSISTANT_TARGET_ID) {
				extension.collector.error(localize('positron.errorActionTargets.reserved', "The error action target id `{0}` is reserved.", POSIT_ASSISTANT_TARGET_ID));
				continue;
			}
			targets.push({ ...raw });
		}
		return targets;
	}

	/** Recompute the available targets and refresh the setting's options. */
	private _updateTargets(): void {
		const installed = new Set(this._extensionService.extensions.map(e => ExtensionIdentifier.toKey(e.identifier)));
		this._targets = this._contributedTargets.filter(target =>
			!target.requiresExtension || installed.has(ExtensionIdentifier.toKey(target.requiresExtension))
		);
		const node = getConfigurationNode(this._targets);
		configurationRegistry.updateConfigurations({ add: [node], remove: [configurationNode] });
		configurationNode = node;
		this._onDidChange.fire();
	}
}

registerSingleton(IErrorActionTargetService, ErrorActionTargetService, InstantiationType.Delayed);

/**
 * Create the service once the workbench is restored, so contributed targets
 * appear in the Settings editor before any Fix/Explain button renders.
 */
class ErrorActionTargetsContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronErrorActionTargets';

	constructor(@IErrorActionTargetService _errorActionTargetService: IErrorActionTargetService) { }
}

registerWorkbenchContribution2(ErrorActionTargetsContribution.ID, ErrorActionTargetsContribution, WorkbenchPhase.Eventually);
