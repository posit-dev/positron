/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import { mock } from '../../../../../base/test/common/mock.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ExtHostLanguageRuntime } from '../../../common/positron/extHostLanguageRuntime.js';
import { MainThreadLanguageRuntimeShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { URI } from '../../../../../base/common/uri.js';

function fakeMetadata(overrides: Partial<ILanguageRuntimeMetadata> = {}): ILanguageRuntimeMetadata {
	return {
		runtimeId: 'r-4.5.0',
		runtimeName: 'R 4.5.0',
		runtimeShortName: '4.5.0',
		runtimePath: '/usr/local/bin/R',
		runtimeVersion: '4.5.0',
		runtimeSource: 'HQ',
		languageId: 'r',
		languageName: 'R',
		languageVersion: '4.5.0',
		base64EncodedIconSvg: undefined,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
		sessionLocation: LanguageRuntimeSessionLocation.Workspace,
		extraRuntimeData: {},
		extensionId: new ExtensionIdentifier('positron.positron-r'),
		...overrides,
	};
}

function createMockShape() {
	return new class extends mock<MainThreadLanguageRuntimeShape>() {
		registrations: ILanguageRuntimeMetadata[] = [];
		override $registerLanguageRuntime(metadata: ILanguageRuntimeMetadata): void {
			this.registrations.push(metadata);
		}
		override $unregisterLanguageRuntime(_runtimeId: string): void {
			// no-op
		}
		override $emitPerfMark(_extensionId: string, _name: string): void {
			// no-op
		}
	};
}

const fakeExtension: IExtensionDescription = {
	identifier: new ExtensionIdentifier('positron.positron-r'),
	isBuiltin: true,
	isUserBuiltin: false,
	isUnderDevelopment: false,
	name: 'positron-r',
	publisher: 'positron',
	version: '0.0.1',
	engines: { vscode: '*' },
	extensionLocation: URI.file('/fake'),
	targetPlatform: 'undefined' as unknown as IExtensionDescription['targetPlatform'],
	preRelease: false,
};

describe('ExtHostLanguageRuntime - onDidRegisterRuntime', function () {

	const disposables = ensureNoLeakedDisposables();

	let shape: ReturnType<typeof createMockShape>;

	beforeEach(() => {
		shape = createMockShape();
	});

	it('$onDidRegisterLanguageRuntime fires the public event', () => {
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
		const seen: ILanguageRuntimeMetadata[] = [];
		disposables.add(runtime.onDidRegisterRuntime(m => seen.push(m)));

		const meta = fakeMetadata();
		runtime.$onDidRegisterLanguageRuntime(meta);

		expect(seen).toEqual([meta]);
	});

	it('cache-loaded runtimes are visible to subscribers via the broadcast path', () => {
		// The bug this guards: cache loader registers a runtime via
		// `_languageRuntimeService.registerRuntime` on the main thread, which
		// historically did not propagate to the ext-host emitter. Now main
		// thread forwards every `onDidRegisterRuntime` event via
		// `$onDidRegisterLanguageRuntime`, so listeners like the reticulate
		// extension see the cache-driven registrations.
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
		const seen: ILanguageRuntimeMetadata[] = [];
		disposables.add(runtime.onDidRegisterRuntime(m => seen.push(m)));

		const r1 = fakeMetadata({ runtimeId: 'r-1' });
		const r2 = fakeMetadata({ runtimeId: 'r-2' });
		// Simulate the main-thread broadcast for two cache-loaded entries.
		runtime.$onDidRegisterLanguageRuntime(r1);
		runtime.$onDidRegisterLanguageRuntime(r2);

		expect(seen).toEqual([r1, r2]);
	});

	it('registerLanguageRuntime does not fire the local emitter directly', () => {
		// `registerLanguageRuntime` only calls `$registerLanguageRuntime` on
		// the proxy and updates local state; the public event fires when the
		// main thread broadcasts back via `$onDidRegisterLanguageRuntime`.
		// Without this round-trip-only firing, runtimes registered locally
		// would emit twice (once locally, once on broadcast).
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
		const seen: ILanguageRuntimeMetadata[] = [];
		disposables.add(runtime.onDidRegisterRuntime(m => seen.push(m)));

		const meta = fakeMetadata();
		disposables.add(runtime.registerLanguageRuntime(fakeExtension, mock<positron.LanguageRuntimeManager>(), meta));

		// The proxy got the registration request...
		expect(shape.registrations.length).toBe(1);
		expect(shape.registrations[0].runtimeId).toBe(meta.runtimeId);
		// ...but the public event has not fired yet (it would on broadcast back).
		expect(seen).toEqual([]);
	});
});
