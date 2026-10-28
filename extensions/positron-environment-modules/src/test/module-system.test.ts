/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildModuleLoadCommand, ShellConfig, supportsPurge } from '../module-system.js';

const bash: ShellConfig = {
	name: 'bash',
	path: '/bin/bash',
	loginArgs: ['-l', '-c'],
	initName: 'bash',
	chainOperator: '&&',
};

suite('module-system', () => {
	test('buildModuleLoadCommand purges before loading when requested', () => {
		assert.strictEqual(
			buildModuleLoadCommand(['gcc/11', 'R/4.4.2'], '/etc/profile.d/modules.sh', bash, true),
			'source "/etc/profile.d/modules.sh" && module purge && module load gcc/11 && module load R/4.4.2'
		);
	});

	test('buildModuleLoadCommand does not purge by default or when disabled', () => {
		const expected = 'source "/init.sh" && module load R/4.4.2';
		assert.strictEqual(buildModuleLoadCommand(['R/4.4.2'], '/init.sh', bash), expected);
		assert.strictEqual(buildModuleLoadCommand(['R/4.4.2'], '/init.sh', bash, false), expected);
	});

	test('buildModuleLoadCommand does not purge when there are no modules to load', () => {
		assert.strictEqual(buildModuleLoadCommand([], '/init.sh', bash, true), 'source "/init.sh"');
	});

	test('supportsPurge is true only for recognized module systems', () => {
		assert.strictEqual(supportsPurge('lmod'), true);
		assert.strictEqual(supportsPurge('environment-modules'), true);
		assert.strictEqual(supportsPurge('unknown'), false);
	});
});
