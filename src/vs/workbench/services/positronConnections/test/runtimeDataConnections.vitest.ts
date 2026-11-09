/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isRuntimeConnectionLanguage } from '../common/runtimeDataConnections.js';

describe('runtimeDataConnections', () => {
	it('keeps only R and Python', () => {
		expect(['r', 'python', 'ggsql', 'test', undefined].map(isRuntimeConnectionLanguage))
			.toEqual([true, true, false, false, false]);
	});
});
