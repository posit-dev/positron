/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AxiosError } from 'axios';
import { isUnauthorizedError } from '../KallichoreAdapterApi';

suite('isUnauthorizedError', () => {
	test('detects a 401 reported on the axios response', () => {
		const err = new AxiosError('Unauthorized');
		// @ts-ignore -- response is normally populated by axios on a real request
		err.response = { status: 401 };
		assert.strictEqual(isUnauthorizedError(err), true);
	});

	test('detects a 401 reported on the axios error status', () => {
		const err = new AxiosError('Unauthorized');
		err.status = 401;
		assert.strictEqual(isUnauthorizedError(err), true);
	});
});
