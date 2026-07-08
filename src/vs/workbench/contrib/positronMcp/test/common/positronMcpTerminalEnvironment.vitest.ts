/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IShellLaunchConfig } from '../../../../../platform/terminal/common/terminal.js';
import { createTerminalEnvironment } from '../../../terminal/common/terminalEnvironment.js';
import { PositronMcpTerminalEnvironmentService } from '../../common/positronMcpTerminalEnvironment.js';

describe('PositronMcpTerminalEnvironmentService', () => {
	it('starts with no environment and maps an endpoint to the env var contract', () => {
		const service = new PositronMcpTerminalEnvironmentService();
		expect(service.getTerminalEnv()).toBeUndefined();

		service.setServer({ url: 'http://localhost:12345', token: 'abc123' });
		expect(service.getTerminalEnv()).toEqual({
			POSITRON_MCP_URL: 'http://localhost:12345',
			POSITRON_MCP_TOKEN: 'abc123',
		});

		service.setServer(undefined);
		expect(service.getTerminalEnv()).toBeUndefined();
	});
});

describe('createTerminalEnvironment positron MCP injection', () => {
	const positronEnv = { POSITRON_MCP_URL: 'http://localhost:12345', POSITRON_MCP_TOKEN: 'abc123' };

	it('merges the MCP vars into a regular terminal environment', async () => {
		const shellLaunchConfig: IShellLaunchConfig = {};
		const env = await createTerminalEnvironment(shellLaunchConfig, undefined, undefined, '1.0.0', 'off', { PATH: '/usr/bin' }, positronEnv);
		expect(env['POSITRON_MCP_URL']).toBe('http://localhost:12345');
		expect(env['POSITRON_MCP_TOKEN']).toBe('abc123');
		expect(env['PATH']).toBe('/usr/bin');
	});

	it('omits the MCP vars when none are provided', async () => {
		const shellLaunchConfig: IShellLaunchConfig = {};
		const env = await createTerminalEnvironment(shellLaunchConfig, undefined, undefined, '1.0.0', 'off', { PATH: '/usr/bin' }, undefined);
		expect(env['POSITRON_MCP_URL']).toBeUndefined();
		expect(env['POSITRON_MCP_TOKEN']).toBeUndefined();
	});

	it('respects strictEnv by not injecting the MCP vars', async () => {
		const shellLaunchConfig: IShellLaunchConfig = { strictEnv: true, env: { ONLY: 'this' } };
		const env = await createTerminalEnvironment(shellLaunchConfig, undefined, undefined, '1.0.0', 'off', { PATH: '/usr/bin' }, positronEnv);
		expect(env['POSITRON_MCP_URL']).toBeUndefined();
		expect(env['POSITRON_MCP_TOKEN']).toBeUndefined();
		expect(env['ONLY']).toBe('this');
	});
});
