/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { SIMPLIFIED_LAYOUT_ENABLED_KEY } from '../../../services/positronLayout/common/positronSimplifiedLayoutConfiguration.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

/** The Remote Explorer container, which the simplified layout hides. */
const REMOTE_EXPLORER_VIEW_CONTAINER_ID = 'workbench.view.remote';

/** True while the simplified layout hides Remote Explorer. */
const REMOTE_EXPLORER_HIDDEN = new RawContextKey<boolean>('positron.remoteExplorerHidden', false);

const SIMPLIFIED_LAYOUT_ON = ContextKeyExpr.equals(`config.${SIMPLIFIED_LAYOUT_ENABLED_KEY}`, true);

/**
 * Keeps the {@link REMOTE_EXPLORER_HIDDEN} context key in step with the view
 * descriptor service, so the palette offers Show or Hide, not both.
 */
export class RemoteExplorerHiddenContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronRemoteExplorerHiddenContext';

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		super();
		const hidden = REMOTE_EXPLORER_HIDDEN.bindTo(contextKeyService);
		const update = () => hidden.set(viewDescriptorService.isViewContainerHidden(REMOTE_EXPLORER_VIEW_CONTAINER_ID));
		update();
		this._register(viewDescriptorService.onDidChangeHiddenViewContainers(update));
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.positron.showRemoteExplorer',
			title: localize2('positron.showRemoteExplorer', "Show Remote Explorer"),
			category: Categories.View,
			f1: true,
			precondition: ContextKeyExpr.and(SIMPLIFIED_LAYOUT_ON, REMOTE_EXPLORER_HIDDEN),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		accessor.get(IViewDescriptorService).setViewContainerHidden(REMOTE_EXPLORER_VIEW_CONTAINER_ID, false);
		await viewsService.openViewContainer(REMOTE_EXPLORER_VIEW_CONTAINER_ID, true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.positron.hideRemoteExplorer',
			title: localize2('positron.hideRemoteExplorer', "Hide Remote Explorer"),
			category: Categories.View,
			f1: true,
			precondition: ContextKeyExpr.and(SIMPLIFIED_LAYOUT_ON, REMOTE_EXPLORER_HIDDEN.negate()),
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IViewDescriptorService).setViewContainerHidden(REMOTE_EXPLORER_VIEW_CONTAINER_ID, true);
	}
});
