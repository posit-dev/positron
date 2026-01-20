/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import * as nls from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { positronSessionViewIcon } from '../../positronSession/browser/positronSessionContainer.js';
import { PositronPackagesView } from './positronPackagesView.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

export const POSITRON_PACKAGES_VIEW_CONTAINER_ID = 'workbench.viewContainer.positronPackages';
export const POSITRON_PACKAGES_VIEW_ID = 'workbench.view.positronPackages.view';

const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_PACKAGES_VIEW_CONTAINER_ID,
	title: nls.localize2("packages", "Packages"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_PACKAGES_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'workbench.packages.views.state',
	icon: Codicon.package,
	alwaysUseContainerInfo: true,
	hideIfEmpty: true,
	order: 50,
	openCommandActionDescriptor: {
		id: "workbench.action.positron.openPackages",
		title: "Packages",
		mnemonicTitle: "Packages",
		keybindings: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyE },
		order: 0
	},
}, ViewContainerLocation.Sidebar, { isDefault: false });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_PACKAGES_VIEW_ID,
			name: {
				value: nls.localize('positron.packages', "Packages"),
				original: 'Packages'
			},
			ctorDescriptor: new SyncDescriptor(PositronPackagesView),
			canToggleVisibility: false,
			canMoveView: true,
			containerIcon: positronSessionViewIcon,
			openCommandActionDescriptor: {
				id: 'workbench.action.positron.togglePackages',
				mnemonicTitle: nls.localize({ key: 'miTogglePackages', comment: ['&& denotes a mnemonic'] }, "&&Packagesoo"),
				keybindings: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
				},
				order: 1,
			},
			focusCommand: {
				id: 'positronPackages.focus',
				keybindings: {
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyV),
				}
			},
			when: ContextKeyExpr.equals('config.positron.environments.enable', true)
		}
	],
	viewContainer
);
