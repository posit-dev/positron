/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { PositronGallerySourceConfigKey, PositronCustomGalleryUrlConfigKey } from '../../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronCustomGalleryValidation } from '../../electron-browser/positronCustomGalleryValidation.js';

type RequestFn = (options: IRequestOptions, token: CancellationToken) => Promise<IRequestContext>;

describe('PositronCustomGalleryValidation', () => {

	function makeRequest(impl?: RequestFn): ReturnType<typeof vi.fn<RequestFn>> {
		return vi.fn<RequestFn>(impl);
	}

	function makeContribution(values: Record<string, string>, request: ReturnType<typeof makeRequest>) {
		const configService = new TestConfigurationService(values);
		const requestService = stubInterface<IRequestService>({ request });
		const notification = stubInterface<INotificationService>({ warn: vi.fn() });
		const log = stubInterface<ILogService>({ warn: vi.fn(), error: vi.fn() });
		return new PositronCustomGalleryValidation(configService, requestService, notification, log);
	}

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('debounces rapid changes into a single probe', async () => {
		// Minimal IRequestContext stub: the contribution only reads res.statusCode
		// and passes the context to asJson (which will throw on a stub stream,
		// caught internally). The cast is a narrowing cast -- the value is
		// structurally compatible with what the contribution consumes.
		// eslint-disable-next-line local/code-no-dangerous-type-assertions -- narrowing cast: only res.statusCode is read by contribution
		const fakeContext = { res: { statusCode: 200, headers: {} }, stream: null } as unknown as IRequestContext;
		const request = makeRequest(() => Promise.resolve(fakeContext));
		const configService = new TestConfigurationService({
			[PositronGallerySourceConfigKey]: 'custom',
			[PositronCustomGalleryUrlConfigKey]: 'https://a.example.com/vscode',
		});
		const requestService = stubInterface<IRequestService>({ request });
		const notification = stubInterface<INotificationService>({ warn: vi.fn() });
		const log = stubInterface<ILogService>({ warn: vi.fn(), error: vi.fn() });
		const contribution = new PositronCustomGalleryValidation(configService, requestService, notification, log);

		// Minimal IConfigurationChangeEvent that only supplies affectsConfiguration.
		const evt = stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: () => true });

		// Fire multiple rapid changes - they should collapse into one probe.
		configService.onDidChangeConfigurationEmitter.fire(evt);
		configService.onDidChangeConfigurationEmitter.fire(evt);
		configService.onDidChangeConfigurationEmitter.fire(evt);

		// Advance past debounce. The startup probe + 3 fired changes all collapse.
		await vi.advanceTimersByTimeAsync(800);

		// All the scheduling collapses: only 1 request call total.
		expect(request).toHaveBeenCalledTimes(1);
		contribution.dispose();
	});

	it('does not probe when the source is not custom', async () => {
		const request = makeRequest();
		const contribution = makeContribution(
			{ [PositronGallerySourceConfigKey]: 'posit-p3m', [PositronCustomGalleryUrlConfigKey]: '' },
			request,
		);
		await vi.advanceTimersByTimeAsync(800);
		expect(request).not.toHaveBeenCalled();
		contribution.dispose();
	});
});
