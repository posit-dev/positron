/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IPositronAcademicLicenseService } from '../../../../../platform/positronLicense/common/positronAcademicLicenseService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IBannerService } from '../../../../services/banner/browser/bannerService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { SHOW_ACADEMIC_LICENSE_BANNER_COMMAND_ID } from '../../browser/positronAcademicLicenseBanner.contribution.js';

// The banner contribution itself bails out before the license check on any non-web build
// (`!isWeb || isWorkbench`), and Vitest runs in Node -- so the show command, which carries the
// same license guard, is the seam that exercises the gate here.
describe('positron.showAcademicLicenseBanner', () => {
	const bannerShow = vi.fn();

	// Read through a getter so a single container can serve both license states -- the stub is
	// captured once at build() time, but the getter resolves when the command handler asks.
	let isAcademic = false;

	const ctx = createTestContainer()
		.stub(IBannerService, { show: bannerShow })
		.stub(IStorageService, { getBoolean: () => false, store: vi.fn() })
		.stub(IPositronAcademicLicenseService, { get isAcademic() { return isAcademic; } })
		.build();

	function runShowCommand() {
		const command = CommandsRegistry.getCommand(SHOW_ACADEMIC_LICENSE_BANNER_COMMAND_ID);
		expect(command).toBeDefined();
		ctx.instantiationService.invokeFunction(command!.handler);
	}

	it('shows the banner under an academic license', () => {
		isAcademic = true;

		runShowCommand();

		expect(bannerShow).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'positron.academicLicense' })
		);
	});

	it('does not show the banner under a non-academic license (e.g. Server Pro on SageMaker)', () => {
		isAcademic = false;

		runShowCommand();

		expect(bannerShow).not.toHaveBeenCalled();
	});
});
