/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IViewContainerModel, IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, ViewContainer, Extensions as ViewExtensions, ViewContainerLocation } from '../../../../common/views.js';
import { Extensions as PaneCompositeExtensions, PaneCompositeRegistry } from '../../../../browser/panecomposite.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../editor/common/editorService.js';
import { IWorkbenchLayoutService } from '../../../layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../panecomposite/browser/panecomposite.js';
import { IViewsService } from '../../common/viewsService.js';
import { openViewPreservingActiveTab } from '../../browser/positronViews.js';
import { ViewsService } from '../../browser/viewsService.js';

describe('openViewPreservingActiveTab', () => {
	const viewContainer = stubInterface<ViewContainer>({ id: 'consoleContainer' });

	async function openWithVisibleContainer(visibleContainerId: string | undefined) {
		const openView = vi.fn(async () => null);
		const viewsService = stubInterface<IViewsService>({
			openView,
			getVisibleViewContainer: () => visibleContainerId === undefined ?
				null :
				stubInterface<ViewContainer>({ id: visibleContainerId }),
		});
		const viewDescriptorService = stubInterface<IViewDescriptorService>({
			getViewContainerByViewId: () => viewContainer,
			getViewContainerLocation: () => ViewContainerLocation.Panel,
		});

		await openViewPreservingActiveTab('consoleView', viewsService, viewDescriptorService);
		return openView;
	}

	it('leaves another visible container showing', async () => {
		expect(await openWithVisibleContainer('terminalContainer')).not.toHaveBeenCalled();
	});

	it('opens the view when its own container is visible', async () => {
		expect(await openWithVisibleContainer('consoleContainer')).toHaveBeenCalledWith('consoleView', false);
	});

	it('opens the view when nothing is showing in its part', async () => {
		expect(await openWithVisibleContainer(undefined)).toHaveBeenCalledWith('consoleView', false);
	});
});

describe('ViewsService focus command', () => {
	const viewContainers = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
	let viewContainer: ViewContainer;

	beforeAll(() => {
		viewContainer = viewContainers.registerViewContainer({
			id: 'test.focusCommand.container',
			title: { value: 'Test', original: 'Test' },
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer),
		}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: true });
	});

	afterEach(() => {
		// ViewsService registers a pane composite for the container and doesn't remove it on dispose.
		Registry.as<PaneCompositeRegistry>(PaneCompositeExtensions.Viewlets).deregisterPaneComposite(viewContainer.id);
	});

	afterAll(() => {
		viewContainers.deregisterViewContainer(viewContainer);
	});

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IPaneCompositePartService, stubInterface<IPaneCompositePartService>({
			onDidPaneCompositeOpen: Event.None,
			onDidPaneCompositeClose: Event.None,
			getRegistryId: () => PaneCompositeExtensions.Viewlets,
		}))
		.stub(IWorkbenchLayoutService, stubInterface<IWorkbenchLayoutService>({}))
		.stub(IEditorService, stubInterface<IEditorService>({}))
		.build();

	/**
	 * Registers a view through a ViewsService and returns its focus command's agent metadata.
	 */
	function focusCommandAgentMetadata(focusCommand: NonNullable<IViewDescriptor['focusCommand']>) {
		const view: IViewDescriptor = {
			id: 'test.focusCommand.view',
			name: { value: 'Test View', original: 'Test View' },
			// ViewsService never creates the view here, as in viewDescriptorService.test.ts.
			ctorDescriptor: null!,
			focusCommand,
		};
		ctx.instantiationService.stub(IViewDescriptorService, stubInterface<IViewDescriptorService>({
			viewContainers: [viewContainer],
			getViewContainerLocation: () => ViewContainerLocation.Sidebar,
			getViewLocationById: () => ViewContainerLocation.Sidebar,
			getViewContainerModel: () => stubInterface<IViewContainerModel>({
				allViewDescriptors: [view],
				activeViewDescriptors: [],
				onDidChangeAllViewDescriptors: Event.None,
				onDidChangeActiveViewDescriptors: Event.None,
			}),
			onDidChangeViewContainers: Event.None,
			onDidChangeContainerLocation: Event.None,
		}));
		ctx.disposables.add(ctx.instantiationService.createInstance(ViewsService));
		const metadata = CommandsRegistry.getCommand(focusCommand.id)?.metadata;
		return { agentCompatible: metadata?.agentCompatible, readOnly: metadata?.readOnly };
	}

	it('passes the view\'s agent flags on to its focus command', () => {
		expect(focusCommandAgentMetadata({ id: 'test.focusCommand.readOnly', agentCompatible: true, readOnly: true }))
			.toEqual({ agentCompatible: true, readOnly: true });
	});

	it('leaves the focus command asking first when the view does not mark it read-only', () => {
		expect(focusCommandAgentMetadata({ id: 'test.focusCommand.asks', agentCompatible: true }))
			.toEqual({ agentCompatible: true, readOnly: undefined });
	});
});
