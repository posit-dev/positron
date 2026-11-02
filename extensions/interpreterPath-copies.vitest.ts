/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isSameInterpreterPath as core } from '../src/vs/workbench/services/languageRuntime/common/interpreterDefinitions';
import * as r from './positron-r/src/interpreter-path';
import * as python from './positron-python/src/client/positron/interpreterPath';

/**
 * The R and Python extensions cannot import from `src/vs`, so each copies
 * core's `isSameInterpreterPath()`. A copy that disagrees with core can yield
 * one interpreter twice (two variants with one label) or reject a pin that
 * core matches. The behavioral tests are on core; this guard extends them to
 * the copies.
 */
const PAIRS: [string, string][] = [
	['C:/Program Files/R/R-4.4.1/bin/x64/R.exe', 'C:\\Program Files\\R\\R-4.4.1\\bin\\x64\\R.exe'],
	['c:\\R\\bin\\R.exe', 'C:\\R\\bin\\R.exe'],
	['C:\\R\\BIN\\R.EXE', 'C:\\R\\bin\\R.exe'],
	['C:\\R\\.\\bin\\\\R.exe', 'C:\\R\\bin\\R.exe'],
	['\\\\SERVER\\share\\R\\bin\\R.exe', '\\\\server\\share\\R\\bin\\R.exe'],
	['//SERVER/share/R/bin/R.exe', '\\\\server\\share\\R\\bin\\R.exe'],
	['//SERVER/share/R/bin/R.exe', '//server/share/R/bin/R.exe'],
	['D:\\R\\bin\\R.exe', 'C:\\R\\bin\\R.exe'],
	['C:\\Python312\\python.exe', '/Python312/python.exe'],
	['/opt/R//bin/R', '/opt/R/bin/R'],
	['/opt/R/./bin/R', '/opt/R/bin/R'],
	['/opt/R/4.4/../4.4/bin/R', '/opt/R/4.4/bin/R'],
	['/opt/R/bin/R', '/opt/r/bin/R'],
	['/opt/R\\bin/R', '/opt/R/bin/R'],
	['//server/share/R', '/server/share/R'],
	['', ''],
];

describe('isSameInterpreterPath copies', () => {
	const expected = PAIRS.map(([a, b]) => core(a, b));

	it('covers both outcomes', () => {
		expect(new Set(expected)).toEqual(new Set([true, false]));
	});

	it.each([['R', r], ['Python', python]])('keeps the %s copy in step with core', (_name, copy) => {
		expect(PAIRS.map(([a, b]) => copy.isSameInterpreterPath(a, b))).toEqual(expected);
	});
});

describe.each([['R', r], ['Python', python]])('%s interpreter path lists', (_name, copy) => {
	const paths = ['C:/R/R-4.4.1/bin/R.exe', 'C:\\R\\R-4.5.0\\bin\\R.exe', 'c:\\R\\R-4.4.1\\bin\\R.exe'];

	it('keeps the first spelling of each interpreter, in order', () => {
		expect(copy.uniqueInterpreterPaths(paths)).toEqual(['C:/R/R-4.4.1/bin/R.exe', 'C:\\R\\R-4.5.0\\bin\\R.exe']);
	});

	it('finds an interpreter written another way, and returns the listed spelling', () => {
		expect([
			copy.includesInterpreterPath(paths, 'C:\\R\\R-4.4.1\\bin\\R.exe'),
			copy.includesInterpreterPath(paths, 'C:\\R\\R-4.3.0\\bin\\R.exe'),
			copy.findInterpreterPath(paths, 'c:\\r\\r-4.4.1\\bin\\r.exe'),
			copy.findInterpreterPath(paths, 'C:\\R\\R-4.3.0\\bin\\R.exe'),
		]).toEqual([true, false, 'C:/R/R-4.4.1/bin/R.exe', undefined]);
	});
});
