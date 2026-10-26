/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommand, ICommandRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { checkGitStatus, getGitStatusNow } from '../../newFolderFromGitStatus.js';

describe('Git status for New Folder from Git', () => {
	/**
	 * Builds the services the checks read. Once the Git extension finishes activating, Git is
	 * found, reported missing, or neither (the extension has not registered its commands).
	 */
	function setup(options: { git: 'found' | 'missing' | 'notReady'; gitEnabled?: boolean; activationFails?: boolean }) {
		const commands = new Set<string>();
		const onDidRegisterCommand = new Emitter<string>();
		const contextKeys = new Map<string, unknown>();
		const registerClone = () => {
			commands.add('git.clone');
			onDidRegisterCommand.fire('git.clone');
		};
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
						registerClone();
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
				onDidRegisterCommand: onDidRegisterCommand.event,
			}),
			configurationService: new TestConfigurationService({ git: { enabled: options.gitEnabled ?? true } }),
		};
		return { services, registerClone };
	}

	it('is available once the Git extension finds Git', async () => {
		const { services } = setup({ git: 'found' });

		expect(await checkGitStatus(services, 0)).toBe('available');
	});

	it('is missing when the Git extension does not find Git', async () => {
		const { services } = setup({ git: 'missing' });

		expect(await checkGitStatus(services, 0)).toBe('missing');
	});

	it('is disabled when git.enabled is off, without waiting for the Git extension', async () => {
		const { services } = setup({ git: 'found', gitEnabled: false });

		expect(getGitStatusNow(services)).toBe('disabled');
		expect(await checkGitStatus(services, 0)).toBe('disabled');
	});

	it('is not ready, rather than missing, when the Git extension cannot activate', async () => {
		const { services } = setup({ git: 'found', activationFails: true });

		expect(await checkGitStatus(services, 0)).toBe('notReady');
	});

	it('is not ready, rather than missing, when the Git extension registers nothing', async () => {
		const { services } = setup({ git: 'notReady' });

		expect(await checkGitStatus(services, 0)).toBe('notReady');
	});

	it('is available when the Git extension finds Git within the grace period', async () => {
		// After 'git.enabled' is turned on, the Git extension searches for Git without activating
		// again, so 'git.clone' arrives after activation has already finished.
		const { services, registerClone } = setup({ git: 'notReady' });

		const status = checkGitStatus(services, 1000);
		setTimeout(registerClone, 10);

		expect(await status).toBe('available');
	});

	it('is known right away only when it does not depend on the Git extension activating', () => {
		const { services, registerClone } = setup({ git: 'notReady' });

		expect(getGitStatusNow(services)).toBeUndefined();
		registerClone();
		expect(getGitStatusNow(services)).toBe('available');
	});
});
