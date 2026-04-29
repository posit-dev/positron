/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mainWindow } from '../../../../../base/browser/window.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { startScrollRestorationLoop } from '../../browser/scrollRestorationLoop.js';

describe('startScrollRestorationLoop', () => {
	const logService = new NullLogService();

	it('performs a synchronous initial correction so callers in pre-paint positions don\'t flash', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		try {
			Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });

			const disposable = startScrollRestorationLoop(container, () => 250, logService);
			try {
				expect(container.scrollTop).toBe(250);
			} finally {
				disposable.dispose();
			}
		} finally {
			container.remove();
		}
	});

	it('self-terminates when the container is no longer connected to the DOM', async () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });

		const disposable = startScrollRestorationLoop(container, () => 100, logService);

		container.remove();

		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));

		const writesBefore = container.scrollTop;
		await new Promise<void>(resolve => setTimeout(resolve, 50));
		expect(container.scrollTop).toBe(writesBefore);

		disposable.dispose();
	});
});
