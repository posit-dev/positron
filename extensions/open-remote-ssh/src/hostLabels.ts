/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ResourceLabelFormatter } from 'vscode';
import type SSHDestination from './ssh/sshDestination';

/**
 * The labels to register for a connected SSH host: one for all SSH hosts and one for this host.
 *
 * Saved labels carry over to other hosts' windows, so only the host-specific one includes the
 * host name (#17410).
 */
export function getHostLabelFormatters(authority: string, sshDest: SSHDestination): ResourceLabelFormatter[] {
	const hostLabel = sshDest.hostname + (sshDest.port && sshDest.port !== 22 ? `:${sshDest.port}` : '');
	return [
		{
			scheme: 'vscode-remote',
			authority: 'ssh-remote+*',
			formatting: { label: '${path}', separator: '/', tildify: true, workspaceSuffix: 'SSH' }
		},
		{
			scheme: 'vscode-remote',
			authority,
			formatting: { label: '${path}', separator: '/', tildify: true, workspaceSuffix: `SSH: ${hostLabel}` }
		}
	];
}
