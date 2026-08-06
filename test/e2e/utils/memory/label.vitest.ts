/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { resolveRole } from './label.js';

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
