/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IMissingPackagesResult, IMissingPackagesService } from '../../common/missingPackagesService.js';
import { PreflightModalResult } from '../../browser/missingPackagesPreflightModal.js';
import { CONFIRM_MISSING_ON_RUN, MissingPackagesPreflightService } from '../../browser/missingPackagesPreflightService.js';

// Mock the modal so tests drive the user's decision without rendering UI.
const { showModal } = vi.hoisted(() => ({ showModal: vi.fn<(...args: unknown[]) => Promise<PreflightModalResult>>() }));
vi.mock('../../browser/missingPackagesPreflightModal.js', () => ({
	showMissingPackagesPreflightModal: showModal,
}));

describe('MissingPackagesPreflightService', () => {
	const resource = URI.file('/foo.py');
	const result: IMissingPackagesResult = {
		resource,
		groups: [{ sessionId: 'py', languageId: 'python', packages: [{ name: 'requests' }] }],
		total: 1,
	};

	// `cached: null` means "nothing cached"; omitting it uses the default result.
	function setup(options: { confirmEnabled?: boolean; cached?: IMissingPackagesResult | null } = {}) {
		const cached = options.cached === undefined ? result : options.cached ?? undefined;
		const getCached = vi.fn().mockReturnValue(cached);
		const ensure = vi.fn().mockResolvedValue(result);
		const install = vi.fn().mockResolvedValue(undefined);
		const missingPackagesService = stubInterface<IMissingPackagesService>({ getCached, ensure, install });

		const updateValue = vi.fn().mockResolvedValue(undefined);
		const configurationService = stubInterface<IConfigurationService>({
			getValue: () => options.confirmEnabled ?? true,
			updateValue,
		});
		const warn = vi.fn();
		const notificationService = stubInterface<INotificationService>({ warn });

		const service = new MissingPackagesPreflightService(missingPackagesService, configurationService, notificationService);
		return { service, getCached, ensure, install, updateValue, warn };
	}

	it('runs without prompting when the setting is disabled', async () => {
		const { service, install } = setup({ confirmEnabled: false });
		expect(await service.confirmBeforeRun(resource)).toBe(true);
		expect(showModal).not.toHaveBeenCalled();
		expect(install).not.toHaveBeenCalled();
	});

	it('runs (and warms the cache) without prompting when nothing is cached', async () => {
		const { service, ensure } = setup({ cached: null });
		expect(await service.confirmBeforeRun(resource)).toBe(true);
		expect(showModal).not.toHaveBeenCalled();
		expect(ensure).toHaveBeenCalledWith(resource);
	});

	it('runs without prompting when there are no missing packages', async () => {
		const { service } = setup({ cached: { resource, groups: [], total: 0 } });
		expect(await service.confirmBeforeRun(resource)).toBe(true);
		expect(showModal).not.toHaveBeenCalled();
	});

	it('installs then runs when the user chooses install-and-run', async () => {
		const { service, install } = setup();
		showModal.mockResolvedValue({ decision: 'install-and-run', dontShowAgain: false });

		expect(await service.confirmBeforeRun(resource)).toBe(true);
		expect(install).toHaveBeenCalledWith(result.groups[0]);
	});

	it('cancels the run when the user cancels', async () => {
		const { service, install } = setup();
		showModal.mockResolvedValue({ decision: 'cancel', dontShowAgain: false });

		expect(await service.confirmBeforeRun(resource)).toBe(false);
		expect(install).not.toHaveBeenCalled();
	});

	it('disables the setting when "Don\'t show again" is checked', async () => {
		const { service, updateValue } = setup();
		showModal.mockResolvedValue({ decision: 'run', dontShowAgain: true });

		await service.confirmBeforeRun(resource);
		expect(updateValue).toHaveBeenCalledWith(CONFIRM_MISSING_ON_RUN, false, ConfigurationTarget.USER);
	});

	it('runs anyway and warns when an install fails', async () => {
		const { service, install, warn } = setup();
		install.mockRejectedValue(new Error('network'));
		showModal.mockResolvedValue({ decision: 'install-and-run', dontShowAgain: false });

		expect(await service.confirmBeforeRun(resource)).toBe(true);
		expect(warn).toHaveBeenCalled();
	});
});
