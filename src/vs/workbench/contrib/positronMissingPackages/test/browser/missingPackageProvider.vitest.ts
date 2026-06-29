/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ConsoleErrorFollowupService, IConsoleError, IConsoleErrorSuggestion } from '../../../../services/positronConsole/common/consoleErrorFollowup.js';
import { ILanguageRuntimeSession, IRuntimeMissingPackage, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IMissingPackagesService } from '../../common/missingPackagesService.js';
import { MissingPackageErrorProvider } from '../../browser/missingPackageProvider.js';

function makeError(overrides: Partial<IConsoleError>): IConsoleError {
	return { sessionId: 's1', languageId: 'python', name: '', message: '', traceback: [], ...overrides };
}

describe('ConsoleErrorFollowupService', () => {
	beforeEach(() => ensureNoLeakedDisposables());

	it('flattens suggestions from all providers and ignores a failing one', async () => {
		const service = new ConsoleErrorFollowupService();
		const suggestion: IConsoleErrorSuggestion = { icon: { id: 'lightbulb' }, label: 'A', run: vi.fn() };
		service.registerProvider({ provideSuggestions: async () => [suggestion] });
		service.registerProvider({ provideSuggestions: async () => { throw new Error('boom'); } });

		const result = await service.getSuggestions(makeError({}), CancellationToken.None);

		expect(result).toEqual([suggestion]);
	});

	it('stops offering a provider once it is disposed', async () => {
		const service = new ConsoleErrorFollowupService();
		const disposable = service.registerProvider({ provideSuggestions: async () => [{ icon: { id: 'lightbulb' }, label: 'A', run: vi.fn() }] });
		disposable.dispose();

		expect(await service.getSuggestions(makeError({}), CancellationToken.None)).toEqual([]);
	});
});

describe('MissingPackageErrorProvider', () => {
	beforeEach(() => ensureNoLeakedDisposables());

	function setup(options: {
		enabled?: boolean;
		missing?: IRuntimeMissingPackage[];
	} = {}) {
		const listMissingPackages = vi.fn<(...args: unknown[]) => Promise<IRuntimeMissingPackage[]>>()
			.mockResolvedValue(options.missing ?? [{ name: 'requests' }]);
		const session = stubInterface<ILanguageRuntimeSession>({ listMissingPackages });
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ getSession: () => session });
		const install = vi.fn().mockResolvedValue(undefined);
		const missingPackagesService = stubInterface<IMissingPackagesService>({ install });
		const configurationService = stubInterface<IConfigurationService>({ getValue: () => options.enabled ?? true });
		const notificationError = vi.fn();
		const notificationService = stubInterface<INotificationService>({ error: notificationError });
		const provider = new MissingPackageErrorProvider(runtimeSessionService, missingPackagesService, configurationService, notificationService);
		return { provider, listMissingPackages, install, notificationError };
	}

	it('offers an install action for a Python missing-module error', async () => {
		const { provider, listMissingPackages, install } = setup();
		const error = makeError({ languageId: 'python', name: 'ModuleNotFoundError', message: `No module named 'requests'` });

		const suggestions = await provider.provideSuggestions(error, CancellationToken.None);

		expect(listMissingPackages).toHaveBeenCalledWith({ code: 'import requests' }, CancellationToken.None);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].label).toBe('Install requests');

		await suggestions[0].run();
		expect(install).toHaveBeenCalledWith({ sessionId: 's1', languageId: 'python', packages: [{ name: 'requests' }] });
	});

	it('matches an R missing-package error with curly quotes', async () => {
		const { provider, listMissingPackages } = setup({ missing: [{ name: 'tidyverse' }] });
		const error = makeError({
			languageId: 'r',
			message: 'Error in library(tidyverse) : there is no package called \u2018tidyverse\u2019',
		});

		const suggestions = await provider.provideSuggestions(error, CancellationToken.None);

		expect(listMissingPackages).toHaveBeenCalledWith({ code: 'library(tidyverse)' }, CancellationToken.None);
		expect(suggestions.map(s => s.label)).toEqual(['Install tidyverse']);
	});

	it('offers nothing when the setting is disabled', async () => {
		const { provider, listMissingPackages } = setup({ enabled: false });
		const error = makeError({ message: `No module named 'requests'` });

		expect(await provider.provideSuggestions(error, CancellationToken.None)).toEqual([]);
		expect(listMissingPackages).not.toHaveBeenCalled();
	});

	it('offers nothing when the analyzer finds no installable package', async () => {
		const { provider } = setup({ missing: [] });
		const error = makeError({ message: `No module named 'garfblatz'` });

		expect(await provider.provideSuggestions(error, CancellationToken.None)).toEqual([]);
	});

	it('surfaces a notification when the install fails, without rejecting', async () => {
		const { provider, install, notificationError } = setup();
		install.mockRejectedValueOnce(new Error('network down'));
		const error = makeError({ languageId: 'python', message: `No module named 'requests'` });

		const suggestions = await provider.provideSuggestions(error, CancellationToken.None);

		// `run` swallows the install failure after surfacing it to the user, so the
		// click handler never sees an unhandled rejection.
		await expect(suggestions[0].run()).resolves.toBeUndefined();
		expect(notificationError).toHaveBeenCalledWith(`Failed to install 'requests': network down`);
	});
});
