/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { diffCapturedEnvironment, parseNullDelimitedEnv } from '../env-capture.js';

suite('env-capture', () => {
	test('parseNullDelimitedEnv handles multi-line values and skips malformed entries', () => {
		const parsed = parseNullDelimitedEnv('PATH=/a:/b\0MULTI=line1\nline2\0MALFORMED\0EMPTY=\0');
		assert.deepStrictEqual(parsed, {
			PATH: '/a:/b',
			MULTI: 'line1\nline2',
			EMPTY: '',
		});
	});

	test('diffCapturedEnvironment classifies each change and omits noise', () => {
		const baseline = {
			PATH: '/usr/bin',
			MANPATH: '/usr/share/man',
			UNCHANGED: 'same',
			SHLVL: '1',
		};
		const loaded = {
			PATH: '/mod/bin:/usr/bin',      // prepend
			MANPATH: '/usr/share/man:/mod/man', // append
			UNCHANGED: 'same',              // omitted
			SHLVL: '2',                     // volatile, omitted
			R_HOME: '/mod/R',               // new -> replace
			LOADEDMODULES: 'R/4.3',         // was absent -> replace
		};

		assert.deepStrictEqual(diffCapturedEnvironment(baseline, loaded), [
			{ name: 'PATH', value: '/mod/bin:', action: 'prepend' },
			{ name: 'MANPATH', value: ':/mod/man', action: 'append' },
			{ name: 'R_HOME', value: '/mod/R', action: 'replace' },
			{ name: 'LOADEDMODULES', value: 'R/4.3', action: 'replace' },
		]);
	});
});
