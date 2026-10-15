/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { posix, win32 } from '../../../../../base/common/path.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPathService } from '../../common/pathService.js';
import { expandHomePath } from '../../common/positronPathUtils.js';

/**
 * Builds a path service for a POSIX or Windows target.
 */
function makePathService(windows = false) {
	const userHome = windows ? URI.file('c:/Users/x') : URI.file('/user/home');
	const pathService = stubInterface<IPathService>({
		path: Promise.resolve(windows ? win32 : posix),
		userHome: vi.fn(async () => userHome) as unknown as IPathService['userHome'],
	});
	return { pathService, userHome };
}

describe('expandHomePath', () => {
	it.each([
		['~', ''],
		['~/clones', '/clones'],
		['~/a/b', '/a/b'],
		['~/a//b/', '/a/b'],
	])('expands %s to the user home', async (path, rest) => {
		const { pathService, userHome } = makePathService();

		expect((await expandHomePath(path, pathService))?.path).toBe(userHome.path + rest);
	});

	it.each(['~clones', '/clones', 'clones', ''])('does not expand %j', async path => {
		const { pathService } = makePathService();

		expect(await expandHomePath(path, pathService)).toBeUndefined();
		expect(pathService.userHome).not.toHaveBeenCalled();
	});

	it('splits on backslashes for a Windows target', async () => {
		const { pathService } = makePathService(true);

		expect((await expandHomePath('~\\clones', pathService))?.path).toBe('/c:/Users/x/clones');
	});

	it('keeps a backslash as part of a name for a POSIX target', async () => {
		const { pathService, userHome } = makePathService();

		expect((await expandHomePath('~/a\\b', pathService))?.path).toBe(`${userHome.path}/a\\b`);
	});

	it('passes preferLocal to userHome', async () => {
		const { pathService } = makePathService();

		await expandHomePath('~', pathService, { preferLocal: false });

		expect(pathService.userHome).toHaveBeenCalledWith({ preferLocal: false });
	});
});
