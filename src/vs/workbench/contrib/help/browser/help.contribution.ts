/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IViewsRegistry, IViewDescriptor, Extensions as ViewExtensions } from 'vs/workbench/common/views';
import { HelpPane } from './helpPane';
import { Registry } from 'vs/platform/registry/common/platform';
import { VIEW_CONTAINER } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';

const _helpDesc = <IViewDescriptor>{
	id: HelpPane.Id,
	name: localize('name', "Help"),
	containerIcon: undefined,
	ctorDescriptor: new SyncDescriptor(HelpPane),
	canToggleVisibility: true,
	canMoveView: true,
	hideByDefault: false,
	collapsed: true,
	order: 2,
	weight: 30,
	focusCommand: { id: 'help.focus' }
};

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([_helpDesc], VIEW_CONTAINER);
