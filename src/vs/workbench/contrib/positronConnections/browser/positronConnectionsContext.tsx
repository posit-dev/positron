/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConnectionsService } from '../../../services/positronConnections/common/interfaces/positronConnectionsService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';

export interface PositronConnectionsServices {
	readonly accessibilityService: IAccessibilityService;
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
	readonly connectionsService: IPositronConnectionsService;
	readonly reactComponentContainer: IReactComponentContainer;
	readonly layoutService: ILayoutService;
	readonly clipboardService: IClipboardService;
	readonly notificationService: INotificationService;
	readonly editorService: IEditorService;
	readonly instantiationService: IInstantiationService;
	readonly modelService: IModelService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly runtimeAffiliationService: IRuntimeStartupService;
	readonly runtimeSessionService: IRuntimeSessionService;
}

const PositronConnectionsContext = createContext<PositronConnectionsServices>(undefined!);

export const PositronConnectionsContextProvider = (
	props: PropsWithChildren<PositronConnectionsServices>
) => {
	return (
		<PositronConnectionsContext.Provider value={props}>
			{props.children}
		</PositronConnectionsContext.Provider>
	);
};

export const usePositronConnectionsContext = () => useContext(PositronConnectionsContext);
