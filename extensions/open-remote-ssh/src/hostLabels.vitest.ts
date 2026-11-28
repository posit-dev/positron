/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getHostLabelFormatters } from './hostLabels';
import SSHDestination from './ssh/sshDestination';

describe('getHostLabelFormatters', () => {
	// The label for all SSH hosts is saved and reused in other hosts' windows (#17410)
	it('keeps the host name out of the label that applies to every SSH host', () => {
		const formatters = getHostLabelFormatters('ssh-remote+my-host', new SSHDestination('my-host'));
		expect(formatters.map(f => [f.authority, f.formatting.workspaceSuffix])).toEqual([
			['ssh-remote+*', 'SSH'],
			['ssh-remote+my-host', 'SSH: my-host'],
		]);
	});
});
