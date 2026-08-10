/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { normalizeProcessName, resolveRole } from './label.js';

describe('resolveRole', () => {
	test('names the root process main', () => {
		const { role, labeled } = resolveRole({ positronName: 'positron', cmd: '/opt/positron/positron', isRoot: true });
		expect(role).toBe('main');
		expect(labeled).toBe(true);
	});

	test.each([
		['gpu-process', 'gpu'],
		['utility-network-service', 'network'],
		['shared-process', 'shared'],
		['pty-host', 'pty_host'],
		['window [1] (Welcome)', 'renderer'],
		['window [2] (some-other-title)', 'renderer'],
		['file-watcher [1]', 'file_watcher'],
		['extension-host [1]', 'extension_host'],
		['agent-host', 'agent_host'],
	])('maps the Positron name %s to %s', (positronName, expected) => {
		const { role, labeled } = resolveRole({ positronName, cmd: 'whatever', isRoot: false });
		expect(role).toBe(expected);
		expect(labeled).toBe(true);
	});

	test('window titles do not leak into the role', () => {
		const a = resolveRole({ positronName: 'window [1] (Welcome)', cmd: 'x', isRoot: false });
		const b = resolveRole({ positronName: 'window [1] (my-project)', cmd: 'x', isRoot: false });
		expect(a.role).toBe(b.role);
	});

	test('falls back to argv for a renderer Positron did not name', () => {
		const { role, labeled } = resolveRole({
			cmd: '/opt/positron/positron --type=renderer --standard-schemes=vscode-webview',
			isRoot: false
		});
		expect(role).toBe('renderer');
		expect(labeled).toBe(false);
	});

	test('recognises the kernel supervisor by executable', () => {
		const { role } = resolveRole({
			cmd: '/opt/positron/resources/app/extensions/positron-supervisor/resources/kallichore/kcserver --log-level debug',
			isRoot: false
		});
		expect(role).toBe('kernel_supervisor');
	});

	test('recognises a language server child', () => {
		const { role } = resolveRole({ positronName: 'electron-nodejs (language-server.js)', cmd: 'node language-server.js', isRoot: false });
		expect(role).toBe('language_server');
	});

	test('an unnamed NodeService utility is unlabeled, never guessed', () => {
		const { role, labeled } = resolveRole({
			cmd: '/opt/positron/positron --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-US',
			isRoot: false
		});
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(false);
	});

	test('a completely unknown process is unlabeled rather than throwing', () => {
		const { role, labeled } = resolveRole({ cmd: '/usr/bin/something-new-nobody-predicted', isRoot: false });
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(false);
	});

	test('a process Positron names but we have not mapped stays unlabeled, and records that it was named', () => {
		// The most useful failure mode. Positron introducing a new named
		// utility should surface as "we know what it is called and have not
		// mapped it yet", which is a far better prompt than a generic bucket.
		const { role, labeled } = resolveRole({ positronName: 'some-new-host [1]', cmd: 'positron --type=utility', isRoot: false });
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(true);
	});
});

describe('normalizeProcessName', () => {
	// Every input here is a real name from CI run 31401098950, where these
	// produced eight "distinct" unlabeled names for five actual processes.
	test('drops the pid a language server carries in its command line', () => {
		const a = normalizeProcessName('/build/positron /build/resources/app/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc --clientProcessId=150');
		const b = normalizeProcessName('/build/positron /build/resources/app/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc --clientProcessId=161');
		expect(a).toBe(b);
		expect(a).not.toMatch(/\d{3}/);
	});

	test('collapses two installed versions of the same server to one name', () => {
		const older = normalizeProcessName('/tmp/vscsmoke/extensions-dir/charliermarsh.ruff-2026.68.0/bundled/libs/bin/ruff server');
		const newer = normalizeProcessName('/tmp/vscsmoke/extensions-dir/charliermarsh.ruff-2026.70.0-linux-x64/bundled/libs/bin/ruff server');
		expect(older).toBe('ruff server');
		expect(newer).toBe('ruff server');
	});

	test('keeps enough to tell processes apart', () => {
		expect(normalizeProcessName('/build/resources/app/extensions/positron-python/python-env-tools/pet server')).toBe('pet server');
		expect(normalizeProcessName('/usr/bin/bash --init-file /build/resources/app/out/vs/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh'))
			.toBe('bash shellIntegration-bash.sh --init-file');
	});

	test('drops volatile socket and log paths from the supervisor command line', () => {
		const first = normalizeProcessName('/build/positron /build/extensions/positron-supervisor/resources/kallichore/kcserver --log-file /tmp/kallichore-7fd2f58c-150.log --handshake-socket /tmp/kc-handshake-NxKaM3/s.sock');
		const second = normalizeProcessName('/build/positron /build/extensions/positron-supervisor/resources/kallichore/kcserver --log-file /tmp/kallichore-91ab22de-207.log --handshake-socket /tmp/kc-handshake-QqZz91/s.sock');
		expect(first).toBe(second);
	});

	test('leaves the names Positron reports itself untouched', () => {
		// These never start with a path, and a window title can contain anything.
		expect(normalizeProcessName('window [1] (Welcome - Positron)')).toBe('window [1] (Welcome - Positron)');
		expect(normalizeProcessName('extension-host [1]')).toBe('extension-host [1]');
		expect(normalizeProcessName('gpu-process')).toBe('gpu-process');
	});
});

describe('roles for processes CI surfaced', () => {
	const role = (positronName: string): string => resolveRole({ positronName, cmd: '', isRoot: false }).role;

	test('labels the processes that were unattributed in the first real run', () => {
		expect(role('zygote')).toBe('zygote');
		expect(role('pet server')).toBe('extension_child');
		expect(role('bash shellIntegration-bash.sh --init-file')).toBe('shell');
		expect(role('positron jsonServerMain --node-ipc --clientProcessId')).toBe('language_server');
		expect(role('ruff server')).toBe('language_server');
	});

	test('still labels the processes Positron names outright', () => {
		expect(role('extension-host [1]')).toBe('extension_host');
		expect(role('window [1] (Welcome)')).toBe('renderer');
		expect(role('pty-host')).toBe('pty_host');
	});
});
