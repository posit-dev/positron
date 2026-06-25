/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { buildBadgeActions, WARN_MISSING_IN_EDITOR } from '../../browser/missingPackagesBadge.js';
import { IMissingPackagesResult, IMissingPackagesService } from '../../common/missingPackagesService.js';

describe('buildBadgeActions', () => {
	const result: IMissingPackagesResult = {
		resource: URI.file('/foo.qmd'),
		groups: [
			{ sessionId: 'py', languageId: 'python', packages: [{ name: 'requests' }, { name: 'opencv-python', referencedName: 'cv2' }] },
			{ sessionId: 'r', languageId: 'r', packages: [{ name: 'dplyr' }] },
		],
		total: 3,
	};

	it('builds an install action, disabled per-package items, and a checked warn toggle', async () => {
		const install = vi.fn().mockResolvedValue(undefined);
		const updateValue = vi.fn().mockResolvedValue(undefined);
		const missingPackagesService = stubInterface<IMissingPackagesService>({ install });
		const configurationService = stubInterface<IConfigurationService>({ updateValue });

		const actions = buildBadgeActions(result, missingPackagesService, configurationService);

		// Project to a comparable shape: label + enabled + checked.
		expect(actions.map(a => ({ label: a.label, enabled: a.enabled, checked: a.checked }))).toMatchInlineSnapshot(`
			[
			  {
			    "checked": undefined,
			    "enabled": true,
			    "label": "Install 3 packages",
			  },
			  {
			    "checked": undefined,
			    "enabled": false,
			    "label": "requests",
			  },
			  {
			    "checked": undefined,
			    "enabled": false,
			    "label": "opencv-python (for cv2)",
			  },
			  {
			    "checked": undefined,
			    "enabled": false,
			    "label": "dplyr",
			  },
			  {
			    "checked": true,
			    "enabled": true,
			    "label": "Warn when packages are missing",
			  },
			]
		`);

		// The install action installs every group.
		await actions[0].run();
		expect(install).toHaveBeenCalledTimes(2);
		expect(install).toHaveBeenCalledWith(result.groups[0]);
		expect(install).toHaveBeenCalledWith(result.groups[1]);

		// The toggle disables the setting at user scope.
		await actions[actions.length - 1].run();
		expect(updateValue).toHaveBeenCalledWith(WARN_MISSING_IN_EDITOR, false, ConfigurationTarget.USER);
	});
});
