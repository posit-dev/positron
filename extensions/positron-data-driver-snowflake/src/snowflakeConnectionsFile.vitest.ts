/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { partitionConnections } from './snowflakeConnectionsFile';

describe('partitionConnections', () => {
	it('keeps entries with an account and names the stubs it skips, in file order', () => {
		expect(partitionConnections({
			workbench: { account: 'myorg-myacct', host: 'h', token: 't', authenticator: 'oauth' },
			stub: { user: 'me' },
			dev: { account: 'myorg-dev', user: 'me' },
			blank: { account: '   ' },
			wrongType: { account: 42 },
			empty: {},
		})).toEqual({
			connectable: {
				workbench: { account: 'myorg-myacct', host: 'h', token: 't', authenticator: 'oauth' },
				dev: { account: 'myorg-dev', user: 'me' },
			},
			skipped: ['stub', 'blank', 'wrongType', 'empty'],
		});
	});

	it('skips nothing when every entry has an account', () => {
		expect(partitionConnections({ dev: { account: 'myorg-dev' } })).toEqual({
			connectable: { dev: { account: 'myorg-dev' } },
			skipped: [],
		});
	});
});
