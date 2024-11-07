/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { PropsWithChildren, createContext, useContext } from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export interface PositronAssistantServices {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
	readonly reactComponentContainer: IReactComponentContainer;
	readonly layoutService: ILayoutService;
	readonly clipboardService: IClipboardService;
	readonly notificationService: INotificationService;
	readonly editorService: IEditorService;
}

const PositronAssistantContext = createContext<PositronAssistantServices>(undefined!);

export const PositronAssistantContextProvider = (
	props: PropsWithChildren<PositronAssistantServices>
) => {
	return (
		<PositronAssistantContext.Provider value={props}>
			{props.children}
		</PositronAssistantContext.Provider>
	);
};

export const usePositronAssistantContext = () => useContext(PositronAssistantContext);
