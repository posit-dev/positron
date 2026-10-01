/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { substituteWorkspaceFolder } from './setting-variables';

describe('substituteWorkspaceFolder', () => {
	it.each([
		['/opt/R/bin/R', '/work/proj', '/opt/R/bin/R'],
		['/opt/R/bin/R', undefined, '/opt/R/bin/R'],
		['${workspaceFolder}/env/bin/R', '/work/proj', '/work/proj/env/bin/R'],
		['${workspaceFolder}/a:${workspaceFolder}/b', '/work/proj', '/work/proj/a:/work/proj/b'],
		['~/R/bin/R', '/work/proj', '~/R/bin/R'],
		['${workspaceFolder}\\env\\R.exe', 'C:\\Users\\me\\My Project', 'C:\\Users\\me\\My Project\\env\\R.exe'],
		['${workspaceFolder}/bin/R', '/work/${odd}', '/work/${odd}/bin/R'],
	])('resolves %s with folder %s', (value, folder, expected) => {
		expect(substituteWorkspaceFolder(value, folder)).toEqual({ resolved: true, value: expected });
	});

	it.each([
		['${workspaceFolder}/env/bin/R', undefined, '${workspaceFolder}', 'noFolder'],
		['${env:R_ROOT}/bin/R', '/work/proj', '${env:R_ROOT}', 'unsupported'],
		['${userHome}/R/bin/R', '/work/proj', '${userHome}', 'unsupported'],
		['/opt/${env:R_VERSION}/bin/R', '/work/proj', '${env:R_VERSION}', 'unsupported'],
		['${workspacefolder}/bin/R', '/work/proj', '${workspacefolder}', 'unsupported'],
		['${workspaceFolder:proj}/bin/R', '/work/proj', '${workspaceFolder:proj}', 'unsupported'],
		['${workspaceFolder}/${foo}/bin/R', '/work/proj', '${foo}', 'unsupported'],
		['${workspaceFolder/bin/R', '/work/proj', '${workspaceFolder/bin/R', 'unsupported'],
	] as const)('does not resolve %s with folder %s', (value, folder, variable, reason) => {
		expect(substituteWorkspaceFolder(value, folder)).toEqual({ resolved: false, variable, reason });
	});
});
