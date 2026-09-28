/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	appendSshEnvironmentParam,
	buildEnvironmentProbeCommand,
	detectSshEnvironment,
	parseEnvironmentProbeOutput,
} from './sshEnvironment';

const CDN_TEMPLATE = 'https://cdn.posit.co/positron/${quality}/reh/${arch-long}/positron-reh-${os}-${arch}-${version}.tar.gz';

describe('detectSshEnvironment', () => {
	it.each([
		['databricks runtime marker', ['DATABRICKS_RUNTIME_VERSION'], 'databricks'],
		['databricks cluster marker', ['DATABRICKS_CLUSTER_ID'], 'databricks'],
		['databricks remote env marker', ['DATABRICKS_REMOTE_ENV'], 'databricks'],
		['no markers at all', [], undefined],
		// Workbench sets these for a user connecting *to* a warehouse from
		// elsewhere; reporting them would flag every such user.
		['only client credentials', ['DATABRICKS_HOST', 'DATABRICKS_TOKEN'], undefined],
		// A Workbench host is an expected deployment even on managed compute.
		['workbench overrides cluster markers', ['DATABRICKS_RUNTIME_VERSION', 'RS_SERVER_URL'], undefined],
		['workbench alone', ['RS_SERVER_URL'], undefined],
	])('%s', (_name, setVariables, expected) => {
		expect(detectSshEnvironment(setVariables as string[])).toBe(expected);
	});
});

describe('the environment probe', () => {
	it('reports names without ever expanding values', () => {
		const command = buildEnvironmentProbeCommand(['DATABRICKS_CLUSTER_ID']);

		expect(command).toBe('[ -n "$DATABRICKS_CLUSTER_ID" ] && echo "ssh-env-set:DATABRICKS_CLUSTER_ID"');
	});

	it('reads back the variables a host reports, ignoring shell profile chatter', () => {
		const stdout = [
			'Welcome to the cluster!',
			'ssh-env-set:DATABRICKS_RUNTIME_VERSION',
			'ssh-env-set:DATABRICKS_CLUSTER_ID',
		].join('\n');

		expect(parseEnvironmentProbeOutput(stdout)).toEqual([
			'DATABRICKS_RUNTIME_VERSION',
			'DATABRICKS_CLUSTER_ID',
		]);
	});

	it('ignores names the probe never asked about', () => {
		expect(parseEnvironmentProbeOutput('ssh-env-set:SOMETHING_ELSE')).toEqual([]);
	});
});

describe('appendSshEnvironmentParam', () => {
	it('appends the parameter and preserves the template placeholders', () => {
		expect(appendSshEnvironmentParam(CDN_TEMPLATE, 'databricks')).toBe(`${CDN_TEMPLATE}?ssh-env=databricks`);
	});

	it('leaves the template alone when nothing was identified', () => {
		expect(appendSshEnvironmentParam(CDN_TEMPLATE, undefined)).toBe(CDN_TEMPLATE);
	});

	it('never sends the parameter to a host that is not ours', () => {
		const mirror = 'https://mirror.example.com/positron/reh/positron-reh-${os}.tar.gz';

		expect(appendSshEnvironmentParam(mirror, 'databricks')).toBe(mirror);
	});

	it('joins onto a template that already carries a query string', () => {
		const withQuery = `${CDN_TEMPLATE}?token=abc`;

		expect(appendSshEnvironmentParam(withQuery, 'databricks')).toBe(`${withQuery}&ssh-env=databricks`);
	});
});
