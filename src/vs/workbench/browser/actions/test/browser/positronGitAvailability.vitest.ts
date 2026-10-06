/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommand, ICommandRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationService, IPromptChoice } from '../../../../../platform/notification/common/notification.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { checkGitAvailable } from '../../positronGitAvailability.js';

describe('checkGitAvailable', () => {
	const notReadyMessage =
		'Git is required to create a folder from a Git repository, but the Git extension is not ready. ' +
		'Check that the built-in Git extension is enabled, and try again.';

	/**
	 * Builds the services the check reads. Once the Git extension finishes activating, Git is
	 * found, reported missing, or neither (the extension has not registered its commands yet).
	 */
	function setup(options: { git: 'found' | 'missing' | 'notReady'; gitEnabled?: boolean; activationFails?: boolean }) {
		const commands = new Set<string>();
		const contextKeys = new Map<string, unknown>();
		const prompt = vi.fn();
		const executeCommand = vi.fn().mockResolvedValue(undefined);
		const services = {
			extensionService: stubInterface<IExtensionService>({
				// Like the Git extension, register 'git.clone' only after detection yields, and
				// only when Git is found.
				activateById: async () => {
					await new Promise(resolve => setTimeout(resolve, 0));
					if (options.activationFails) {
						throw new Error('Unknown extension vscode.git');
					}
					if (options.git === 'found') {
						commands.add('git.clone');
					} else if (options.git === 'missing') {
						contextKeys.set('git.missing', true);
					}
				},
			}),
			contextKeyService: stubInterface<IContextKeyService>({
				getContextKeyValue: <T>(key: string) => contextKeys.get(key) as T | undefined,
			}),
			commandRegistry: stubInterface<ICommandRegistry>({
				getCommand: (id: string) => commands.has(id) ? stubInterface<ICommand>({ id }) : undefined,
			}),
			configurationService: new TestConfigurationService({ git: { enabled: options.gitEnabled ?? true } }),
			commandService: stubInterface<ICommandService>({ executeCommand }),
			notificationService: stubInterface<INotificationService>({ prompt }),
		};
		return { services, prompt, executeCommand };
	}

	it('allows the flow when Git is present', async () => {
		const { services, prompt } = setup({ git: 'found' });

		expect(await checkGitAvailable(services)).toBe(true);
		expect(prompt).not.toHaveBeenCalled();
	});

	it('blocks the flow when Git is not found', async () => {
		const { services } = setup({ git: 'missing' });

		expect(await checkGitAvailable(services)).toBe(false);
	});

	it('says Git is not ready, rather than missing, when the Git extension cannot activate', async () => {
		const { services, prompt } = setup({ git: 'found', activationFails: true });

		expect(await checkGitAvailable(services)).toBe(false);
		expect(prompt.mock.calls[0][1]).toBe(notReadyMessage);
		expect(prompt.mock.calls[0][2]).toEqual([]);
	});

	it('says Git is not ready, rather than missing, when the Git extension has not finished starting', async () => {
		const { services, prompt } = setup({ git: 'notReady' });

		expect(await checkGitAvailable(services)).toBe(false);
		expect(prompt.mock.calls[0][1]).toBe(notReadyMessage);
	});

	it('tells the user to install Git or set git.path when Git is missing', async () => {
		const { services, prompt } = setup({ git: 'missing' });

		await checkGitAvailable(services);

		expect(prompt.mock.calls[0][1]).toBe(
			'Git is required to create a folder from a Git repository, but Git was not found. ' +
			'Install Git, or set its location with the \'git.path\' setting, then reload the window.'
		);
	});

	it('offers to reload the window once Git is installed', async () => {
		const { services, prompt, executeCommand } = setup({ git: 'missing' });

		await checkGitAvailable(services);
		const choices = prompt.mock.calls[0][2] as IPromptChoice[];
		choices[0].run();

		expect(choices.map(choice => choice.label)).toEqual(['Reload Window']);
		expect(executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
	});

	it('explains that Git is disabled and offers the setting to enable it', async () => {
		const { services, prompt, executeCommand } = setup({ git: 'found', gitEnabled: false });

		expect(await checkGitAvailable(services)).toBe(false);
		const [openSettings] = prompt.mock.calls[0][2] as IPromptChoice[];
		openSettings.run();

		expect(prompt.mock.calls[0][1]).toBe(
			'Git is required to create a folder from a Git repository, but Git is disabled. ' +
			'Turn on the \'git.enabled\' setting to use it.'
		);
		expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'git.enabled');
	});
});
