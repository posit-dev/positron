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

/** The Remote Explorer container, which every task layout hides. */
const REMOTE_EXPLORER_VIEW_CONTAINER_ID = 'workbench.view.remote';

/** True while the current layout hides Remote Explorer. */
const REMOTE_EXPLORER_HIDDEN = new RawContextKey<boolean>('positron.remoteExplorerHidden', false);

/** True when the user chose to show Remote Explorer in every layout. */
const REMOTE_EXPLORER_SHOWN_BY_USER = new RawContextKey<boolean>('positron.remoteExplorerShownByUser', false);

const SIMPLIFIED_LAYOUT_ON = ContextKeyExpr.equals(`config.${SIMPLIFIED_LAYOUT_ENABLED_KEY}`, true);

/**
 * Keeps the Remote Explorer context keys in step with the view descriptor
 * service, so the palette offers Show or Hide, not both, and offers Hide only
 * when it would do something.
 */
export class RemoteExplorerHiddenContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronRemoteExplorerHiddenContext';

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		super();
		const hidden = REMOTE_EXPLORER_HIDDEN.bindTo(contextKeyService);
		const shownByUser = REMOTE_EXPLORER_SHOWN_BY_USER.bindTo(contextKeyService);
		const update = () => {
			hidden.set(viewDescriptorService.isViewContainerHidden(REMOTE_EXPLORER_VIEW_CONTAINER_ID));
			shownByUser.set(viewDescriptorService.isViewContainerShownByUser(REMOTE_EXPLORER_VIEW_CONTAINER_ID));
		};
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
		accessor.get(IViewDescriptorService).setViewContainerShownByUser(REMOTE_EXPLORER_VIEW_CONTAINER_ID, true);
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
			precondition: ContextKeyExpr.and(SIMPLIFIED_LAYOUT_ON, REMOTE_EXPLORER_SHOWN_BY_USER),
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IViewDescriptorService).setViewContainerShownByUser(REMOTE_EXPLORER_VIEW_CONTAINER_ID, false);
	}
});
