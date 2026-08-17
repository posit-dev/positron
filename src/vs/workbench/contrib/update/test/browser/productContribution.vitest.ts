/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, IPromptChoice } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../../services/environment/browser/environmentService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { TestProductService } from '../../../../test/common/workbenchTestServices.js';
import { ProductContribution } from '../../browser/update.js';

describe('ProductContribution', () => {
	const RELEASE_NOTES_URL = 'https://positron.posit.co/release-notes.html';

	const CURRENT_VERSION = '2026.09.0';
	const PREVIOUS_VERSION = '2026.08.0';

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	const show = vi.fn<() => Promise<boolean>>();
	const prompt = vi.fn();
	const open = vi.fn<(uri: URI) => Promise<boolean>>();

	// `ProductContribution` only uses IInstantiationService to create the release
	// notes editor manager; returning a fake with a controllable `show` lets tests
	// choose whether the in-editor path succeeds or falls back to the notification.
	const instantiationService = stubInterface<IInstantiationService>({
		createInstance: (() => ({ show })) as unknown as IInstantiationService['createInstance'],
	});

	function createContribution(productOverrides: Partial<IProductService> = {}): void {
		new ProductContribution(
			ctx.get(IStorageService),
			instantiationService,
			stubInterface<INotificationService>({ prompt }),
			stubInterface<IBrowserWorkbenchEnvironmentService>({ skipReleaseNotes: false }),
			stubInterface<IOpenerService>({ open }),
			ctx.get(IConfigurationService),
			stubInterface<IHostService>({ hadLastFocus: () => Promise.resolve(true) }),
			{
				...TestProductService,
				positronVersion: CURRENT_VERSION,
				releaseNotesUrl: RELEASE_NOTES_URL,
				downloadUrl: 'https://positron.posit.co/download',
				...productOverrides,
			},
		);
	}

	beforeEach(async () => {
		const configuration = ctx.get(IConfigurationService) as TestConfigurationService;
		configuration.setUserConfiguration('update.showReleaseNotes', true);
		configuration.setUserConfiguration('update.showPostInstallInfo', false);
		configuration.setUserConfiguration('update.positron.channel', 'releases');

		ctx.get(IStorageService).store(ProductContribution.KEY, PREVIOUS_VERSION, StorageScope.APPLICATION, StorageTarget.MACHINE);
	});

	it('prompts with releaseNotesUrl, not downloadUrl, when the release notes editor fails', async () => {
		show.mockRejectedValue(new Error('release notes not published'));

		createContribution();

		await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
		const [, message, choices] = prompt.mock.calls[0] as [unknown, string, IPromptChoice[]];
		expect(message).toContain(CURRENT_VERSION);
		expect(choices[0].label).toBe('Release Notes');

		choices[0].run();

		expect(open).toHaveBeenCalledOnce();
		expect(open.mock.calls[0][0].toString()).toBe(RELEASE_NOTES_URL);
	});

	it('skips the release notes flow when no releaseNotesUrl is configured', async () => {
		show.mockRejectedValue(new Error('release notes not published'));

		createContribution({ releaseNotesUrl: undefined });

		// The stored version is always advanced to the running version, which
		// marks the end of the startup flow.
		await vi.waitFor(() => {
			expect(ctx.get(IStorageService).get(ProductContribution.KEY, StorageScope.APPLICATION)).toBe(CURRENT_VERSION);
		});
		expect(show).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
	});
});
