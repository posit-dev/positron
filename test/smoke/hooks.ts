/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export const mochaHooks = {
	beforeAll: async function () {
		// one-time setup
		console.log(' *** MH beforeAll2 ***');
	},
	beforeEach: function () {
		// global setup for all tests
		console.log(' *** MH beforeEach2 ***');
	},
	afterAll: function () {
		// one-time final cleanup
		console.log(' *** MH afterAll2 ***');
	}
};
