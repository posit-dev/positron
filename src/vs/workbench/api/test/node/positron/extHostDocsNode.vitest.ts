/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostConfiguration } from '../../../common/extHostConfiguration.js';
import { IExtHostInitDataService } from '../../../common/extHostInitDataService.js';
import { deriveBundleRequest, NodeExtHostDocs } from '../../../node/positron/extHostDocsNode.js';

// `quality` is spelled out in the default rather than filled in with `??`, so a
// caller can pass `quality: undefined` to model a dev build.
function initData(overrides: { quality?: string | undefined; version?: string; build?: number } = { quality: 'releases' }) {
	return stubInterface<IExtHostInitDataService>({
		quality: overrides.quality,
		positronVersion: overrides.version ?? '2026.05.0',
		positronBuildNumber: overrides.build ?? 179,
		environment: stubInterface<IExtHostInitDataService['environment']>({
			globalStorageHome: URI.file('/userdata/User/globalStorage'),
		}),
	});
}

describe('deriveBundleRequest', () => {
	it('reads version, build number, and quality from init data', () => {
		expect(deriveBundleRequest(initData(), {})).toMatchObject({
			quality: 'releases',
			positronVersion: '2026.05.0',
			positronBuildNumber: 179,
		});
	});

	it('falls back to the product.json default when no env override is set', () => {
		expect(deriveBundleRequest(initData(), {}).baseUrl)
			.toBe('https://cdn.posit.co/positron/releases/docs');
	});

	it('lets POSITRON_LLMS_DOCS_URL take precedence over the product.json value', () => {
		// This override is what makes the feature verifiable on demand against
		// a local fixture server, since product.json is baked at build time.
		expect(deriveBundleRequest(initData(), { POSITRON_LLMS_DOCS_URL: 'http://127.0.0.1:8099/docs' }).baseUrl)
			.toBe('http://127.0.0.1:8099/docs');
	});

	it('ignores an empty POSITRON_LLMS_DOCS_URL rather than building a relative URL', () => {
		expect(deriveBundleRequest(initData(), { POSITRON_LLMS_DOCS_URL: '' }).baseUrl)
			.toBe('https://cdn.posit.co/positron/releases/docs');
	});

	it('resolves the profile to positron on desktop', () => {
		// isWorkbench is false in the Vitest process, which has no RS_SERVER_URL.
		expect(deriveBundleRequest(initData(), {}).profile).toBe('positron');
	});

	it('passes an undefined quality through for dev builds', () => {
		expect(deriveBundleRequest(initData({ quality: undefined }), {}).quality).toBeUndefined();
	});
});

describe('NodeExtHostDocs construction', () => {
	// The one risk specific to hosting this on the extension host is a slow or
	// hung download landing on an activation path. The constructor must only
	// install a scheduler and a config listener, so it must not have created
	// the cache directory or resolved the barrier-gated config provider.
	it('performs no filesystem or configuration work', async () => {
		const root = join(tmpdir(), `positron-docs-ctor-${randomUUID()}`);
		const getConfigProvider = vi.fn(() => new Promise<never>(() => { }));
		const service = new NodeExtHostDocs(
			stubInterface<IExtHostInitDataService>({
				quality: 'dailies',
				positronVersion: '2026.05.0',
				positronBuildNumber: 179,
				environment: stubInterface<IExtHostInitDataService['environment']>({
					globalStorageHome: URI.file(join(root, 'globalStorage')),
				}),
			}),
			stubInterface<IExtHostConfiguration>({ getConfigProvider }),
			new NullLogService(),
		);

		expect(existsSync(join(root, 'positron-docs'))).toBe(false);
		expect(getConfigProvider).not.toHaveBeenCalled();
		service.dispose();
	});
});
