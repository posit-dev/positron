/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Registry } from '../../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize2 } from '../../../../../nls.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { ViewDescriptorService } from '../../browser/viewDescriptorService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

const ViewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

describe('ViewDescriptorService.getDefaultViewContainer', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	const registered: ViewContainer[] = [];

	/** Register a panel default container with the given order, tracked for cleanup. */
	function registerPanelDefault(order: number | undefined): ViewContainer {
		const container = ViewContainersRegistry.registerViewContainer({
			id: `testDefaultContainer-${generateUuid()}`,
			title: localize2('test', 'Test'),
			// The pane container is never instantiated in this test; only the
			// container metadata (order) is exercised.
			// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
			ctorDescriptor: new SyncDescriptor(<any>{}),
			order,
		}, ViewContainerLocation.Panel, { isDefault: true });
		registered.push(container);
		return container;
	}

	afterEach(() => {
		while (registered.length) {
			ViewContainersRegistry.deregisterViewContainer(registered.pop()!);
		}
	});

	it('returns the lowest-order default container regardless of registration order', () => {
		// Register the higher-order container first so registration order and
		// `order` disagree. This mirrors the real bug: Terminal (order 2) is
		// imported before the Console (order 1), so without honoring `order`
		// the Terminal would win.
		const higherOrder = registerPanelDefault(2);
		const lowerOrder = registerPanelDefault(1);

		const testObject = ctx.disposables.add(ctx.instantiationService.createInstance(ViewDescriptorService));

		expect(testObject.getDefaultViewContainer(ViewContainerLocation.Panel)).toBe(lowerOrder);
		expect(testObject.getDefaultViewContainer(ViewContainerLocation.Panel)).not.toBe(higherOrder);
	});

	it('prefers a container with an explicit order over one without', () => {
		const ordered = registerPanelDefault(1);
		registerPanelDefault(undefined);

		const testObject = ctx.disposables.add(ctx.instantiationService.createInstance(ViewDescriptorService));

		expect(testObject.getDefaultViewContainer(ViewContainerLocation.Panel)).toBe(ordered);
	});
});
