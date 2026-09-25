/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import { Emitter } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ExtensionMessageCollector, ExtensionPoint, ExtensionsRegistry } from '../../../../services/extensions/common/extensionsRegistry.js';
import { ERROR_ACTIONS_TARGET_KEY, IErrorActionTarget } from '../../common/errorActionTargets.js';
import { ErrorActionTargetService } from '../../browser/errorActionTargetService.js';

const extension = (id: string) => ({ identifier: new ExtensionIdentifier(id) } as IExtensionDescription);

const claudeCodeTarget: IErrorActionTarget = {
	id: 'claude-code',
	label: 'Claude Code',
	command: 'positron-claude-code.sendError',
	requiresExtension: 'anthropic.claude-code',
};

describe('ErrorActionTargetService', () => {
	const onDidChangeExtensions = new Emitter<unknown>();
	const installedExtensions: IExtensionDescription[] = [];
	const executeCommand = vi.fn().mockResolvedValue(undefined);
	const notifyError = vi.fn();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IExtensionService, {
			get extensions() { return installedExtensions; },
			onDidChangeExtensions: onDidChangeExtensions.event,
		})
		.stub(ICommandService, { executeCommand })
		.stub(INotificationService, { error: notifyError })
		.build();

	const extensionPoint = ExtensionsRegistry.getExtensionPoints()
		.find(point => point.name === 'errorActionTargets') as ExtensionPoint<IErrorActionTarget[]>;

	/** Make an extension contribute the given targets. */
	function contribute(extensionId: string, targets: IErrorActionTarget[]) {
		const description = extension(extensionId);
		extensionPoint.acceptUsers([{
			description,
			value: targets,
			collector: new ExtensionMessageCollector(() => { }, description, 'errorActionTargets'),
		}]);
	}

	function createService() {
		const service = ctx.instantiationService.createInstance(ErrorActionTargetService);
		ctx.disposables.add(service);
		return service;
	}

	beforeEach(() => {
		installedExtensions.length = 0;
		contribute('positron.positron-claude-code', []);
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(ERROR_ACTIONS_TARGET_KEY, 'claude-code');
	});

	it('offers a target once its required extension is installed', () => {
		const service = createService();
		contribute('positron.positron-claude-code', [claudeCodeTarget]);
		expect(service.targets).toEqual([]);
		expect(service.getConfiguredTarget()).toBeUndefined();

		installedExtensions.push(extension('anthropic.claude-code'));
		onDidChangeExtensions.fire(undefined);

		expect(service.targets).toEqual([claudeCodeTarget]);
		expect(service.getConfiguredTarget()).toEqual(claudeCodeTarget);
	});

	it('falls back to Posit Assistant when another target is selected', () => {
		const service = createService();
		installedExtensions.push(extension('anthropic.claude-code'));
		contribute('positron.positron-claude-code', [claudeCodeTarget]);
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(ERROR_ACTIONS_TARGET_KEY, 'posit-assistant');

		expect(service.getConfiguredTarget()).toBeUndefined();
	});

	it('rejects a contribution that reuses the reserved posit-assistant id', () => {
		const service = createService();
		contribute('some.extension', [{ id: 'posit-assistant', label: 'Impostor', command: 'x' }]);
		expect(service.targets).toEqual([]);
	});

	it('adds available targets to the setting options', () => {
		createService();
		installedExtensions.push(extension('anthropic.claude-code'));
		contribute('positron.positron-claude-code', [claudeCodeTarget]);

		const properties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		expect(properties[ERROR_ACTIONS_TARGET_KEY].enum).toEqual(['posit-assistant', 'claude-code']);
	});

	it('runs the target command with the request', async () => {
		const service = createService();
		const request = { action: 'fix' as const, prompt: 'Fix it.', context: 'boom', contextName: 'Console Error' };
		await service.run(claudeCodeTarget, request);
		expect(executeCommand).toHaveBeenCalledWith('positron-claude-code.sendError', request);
	});

	it('surfaces a notification when the target command fails', async () => {
		const service = createService();
		executeCommand.mockRejectedValueOnce(new Error('command not found'));
		await service.run(claudeCodeTarget, { action: 'fix', prompt: 'Fix it.', context: '', contextName: 'Console Error' });
		expect(notifyError).toHaveBeenCalledWith('Could not send the error to Claude Code: command not found');
	});
});
