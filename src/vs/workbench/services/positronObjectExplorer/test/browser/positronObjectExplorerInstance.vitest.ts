/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ObjectExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { JsonObjectExplorerBackend } from '../../common/jsonObjectExplorerBackend.js';
import { PositronObjectExplorerInstance } from '../../browser/positronObjectExplorerInstance.js';
import { OBJECT_EXPLORER_MAX_DEPTH_KEY } from '../../browser/positronObjectExplorerConfiguration.js';

describe('PositronObjectExplorerInstance', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	function createInstance() {
		const backend = new JsonObjectExplorerBackend('json:test', 'data.json', { a: 1 });
		const client = new ObjectExplorerClientInstance(backend);
		const instance = ctx.disposables.add(ctx.instantiationService.createInstance(PositronObjectExplorerInstance, 'JSON', client, false, undefined));
		const reloadAll = vi.spyOn(instance.treeInstance, 'reloadAll');
		return { backend, instance, reloadAll };
	}

	it('learns its title from the backend', async () => {
		const { instance } = createInstance();

		await vi.waitFor(() => expect(instance.title).toBe('data.json'));
	});

	it('reloads on update only while an editor shows it, catching up when one does', () => {
		const { backend, instance, reloadAll } = createInstance();

		backend.setRoot({ b: 2 });
		expect(reloadAll).not.toHaveBeenCalled();

		instance.setVisible(true);
		expect(reloadAll).toHaveBeenCalledTimes(1);

		backend.setRoot({ c: 3 });
		expect(reloadAll).toHaveBeenCalledTimes(2);
	});

	it('reloads when the maximum depth changes', () => {
		const { instance, reloadAll } = createInstance();
		instance.setVisible(true);
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;

		configurationService.setUserConfiguration(OBJECT_EXPLORER_MAX_DEPTH_KEY, 2);
		configurationService.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({
			affectsConfiguration: (key: string) => key === OBJECT_EXPLORER_MAX_DEPTH_KEY
		}));

		expect(reloadAll).toHaveBeenCalledTimes(1);
	});

	describe('search', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		function createSearchInstance() {
			const { backend, instance } = createInstance();
			backend.setRoot({ alpha: { needle: 1 }, beta: 'needle', gamma: 'hay' });
			const search = vi.spyOn(backend, 'search');
			return { instance, search };
		}

		it('waits longer before searching for short queries', async () => {
			const { instance, search } = createSearchInstance();

			instance.setSearchText('ne');
			await vi.advanceTimersByTimeAsync(999);
			const beforeLongDelay = search.mock.calls.length;
			await vi.advanceTimersByTimeAsync(1);

			instance.setSearchText('needle');
			await vi.advanceTimersByTimeAsync(400);

			expect([beforeLongDelay, search.mock.calls.map(call => call[0])]).toEqual([0, ['ne', 'needle']]);
		});

		it('shows only the results of the latest query', async () => {
			const { instance, search } = createSearchInstance();

			instance.setSearchText('needle');
			await vi.advanceTimersByTimeAsync(400);
			instance.setSearchText('hay');
			await vi.advanceTimersByTimeAsync(399);
			instance.setSearchText('alpha');
			await vi.advanceTimersByTimeAsync(400);

			expect(search.mock.calls.map(call => call[0])).toEqual(['needle', 'alpha']);
			expect(instance.searchResults?.query).toBe('alpha');
			expect(instance.activeTreeInstance).not.toBe(instance.treeInstance);
		});

		it('restores the tree when the search is cleared', async () => {
			const { instance } = createSearchInstance();
			const activeTrees: unknown[] = [];
			ctx.disposables.add(instance.onDidChangeSearch(() => activeTrees.push(instance.activeTreeInstance)));

			instance.setSearchText('needle');
			await vi.advanceTimersByTimeAsync(400);
			instance.setSearchText('');

			expect(activeTrees.length).toBe(2);
			expect(activeTrees[1]).toBe(instance.treeInstance);
			expect(instance.searchResults).toBeUndefined();
		});
	});
});

