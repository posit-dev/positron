/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/panelpart.css';
import { localize, localize2 } from '../../../../nls.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { MenuId, MenuRegistry, registerAction2, Action2, IAction2Options } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { isHorizontal, IWorkbenchLayoutService, PanelAlignment, Parts, Position, positionToString } from '../../../services/layout/browser/layoutService.js';
import { IsAuxiliaryWindowContext, PanelAlignmentContext, PanelMaximizedContext, PanelPositionContext, PanelVisibleContext } from '../../../common/contextkeys.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ViewContainerLocation, IViewDescriptorService } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandActionTitle } from '../../../../platform/action/common/action.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { SwitchCompositeViewAction } from '../compositeBarActions.js';

const maximizeIcon = registerIcon('panel-maximize', Codicon.screenFull, localize('maximizeIcon', 'Icon to maximize a panel.'));
export const closeIcon = registerIcon('panel-close', Codicon.close, localize('closeIcon', 'Icon to close a panel.'));
const panelIcon = registerIcon('panel-layout-icon', Codicon.layoutPanel, localize('togglePanelOffIcon', 'Icon to toggle the panel off when it is on.'));
const panelOffIcon = registerIcon('panel-layout-icon-off', Codicon.layoutPanelOff, localize('togglePanelOnIcon', 'Icon to toggle the panel on when it is off.'));

// --- Start Positron ---
const positronMaximizePanelIcon = registerIcon('positron-maximize-panel', Codicon.chromeMaximize, localize('maximizeIcon', 'Icon to maximize a panel.'));
const positronMinimizePanelIcon = registerIcon('positron-minimize-panel', Codicon.chromeMinimize, localize('minimizeIcon', 'Icon to minimize a panel.'));
const positronRestorePanelIcon = registerIcon('positron-restore-panel', Codicon.chromeRestore, localize('restoreIcon', 'Icon to restore a panel.'));
// --- End Positron ---

export class TogglePanelAction extends Action2 {

	static readonly ID = 'workbench.action.togglePanel';
	static readonly LABEL = localize2('togglePanelVisibility', "Toggle Panel Visibility");

	constructor() {
		super({
			id: TogglePanelAction.ID,
			title: TogglePanelAction.LABEL,
			toggled: {
				condition: PanelVisibleContext,
				title: localize('closePanel', 'Hide Panel'),
				icon: closeIcon,
				mnemonicTitle: localize({ key: 'miTogglePanelMnemonic', comment: ['&& denotes a mnemonic'] }, "&&Panel"),
			},
			icon: closeIcon,
			f1: true,
			category: Categories.View,
			metadata: {
				description: localize('openAndClosePanel', 'Open/Show and Close/Hide Panel'),
			},
			keybinding: { primary: KeyMod.CtrlCmd | KeyCode.KeyJ, weight: KeybindingWeight.WorkbenchContrib },
			menu: [
				{
					id: MenuId.MenubarAppearanceMenu,
					group: '2_workbench_layout',
					order: 5
				}, {
					id: MenuId.LayoutControlMenuSubmenu,
					group: '0_workbench_layout',
					order: 4
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);

		// --- Start Positron ---
		// If the panel is minimized, restore it instead of toggling it.
		if (layoutService.isPanelMinimized()) {
			layoutService.restorePanel();
			return;
		}
		// --- End Positron ---

		layoutService.setPartHidden(layoutService.isVisible(Parts.PANEL_PART), Parts.PANEL_PART);
	}
}

registerAction2(TogglePanelAction);

MenuRegistry.appendMenuItem(MenuId.PanelTitle, {
	command: {
		id: TogglePanelAction.ID,
		title: localize('closePanel', 'Hide Panel'),
		icon: closeIcon
	},
	group: 'navigation',
	order: 2
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.closePanel',
			title: localize2('closePanel', 'Hide Panel'),
			category: Categories.View,
			precondition: PanelVisibleContext,
			f1: true,
			// --- Start Positron ---
			menu: [
				{
					id: MenuId.CommandPalette,
					when: PanelVisibleContext,
				},
				// In Positron, we do not show the X close option on the panel. The user can still
				// close the panel using the View / Appearance menu or Ctrl/Cmd+J. We just don't
				// show the icon to do this.
				// {
				// 	id: MenuId.PanelTitle,
				// 	group: 'navigation',
				// 	order: 2
				// }
			]
			// --- End Positron ---
		});
	}
	run(accessor: ServicesAccessor) {
		accessor.get(IWorkbenchLayoutService).setPartHidden(true, Parts.PANEL_PART);
	}
});

registerAction2(class extends Action2 {

	static readonly ID = 'workbench.action.focusPanel';
	static readonly LABEL = localize('focusPanel', "Focus into Panel");

	constructor() {
		super({
			id: 'workbench.action.focusPanel',
			title: localize2('focusPanel', "Focus into Panel"),
			category: Categories.View,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const paneCompositeService = accessor.get(IPaneCompositePartService);

		// Show panel
		if (!layoutService.isVisible(Parts.PANEL_PART)) {
			layoutService.setPartHidden(false, Parts.PANEL_PART);
		}

		// Focus into active panel
		const panel = paneCompositeService.getActivePaneComposite(ViewContainerLocation.Panel);
		panel?.focus();
	}
});

const PositionPanelActionId = {
	LEFT: 'workbench.action.positionPanelLeft',
	RIGHT: 'workbench.action.positionPanelRight',
	BOTTOM: 'workbench.action.positionPanelBottom',
	TOP: 'workbench.action.positionPanelTop'
};

const AlignPanelActionId = {
	LEFT: 'workbench.action.alignPanelLeft',
	RIGHT: 'workbench.action.alignPanelRight',
	CENTER: 'workbench.action.alignPanelCenter',
	JUSTIFY: 'workbench.action.alignPanelJustify',
};

interface PanelActionConfig<T> {
	id: string;
	when: ContextKeyExpression;
	title: ICommandActionTitle;
	shortLabel: string;
	value: T;
}

function createPanelActionConfig<T>(id: string, title: ICommandActionTitle, shortLabel: string, value: T, when: ContextKeyExpression): PanelActionConfig<T> {
	return {
		id,
		title,
		shortLabel,
		value,
		when,
	};
}

function createPositionPanelActionConfig(id: string, title: ICommandActionTitle, shortLabel: string, position: Position): PanelActionConfig<Position> {
	return createPanelActionConfig<Position>(id, title, shortLabel, position, PanelPositionContext.notEqualsTo(positionToString(position)));
}

function createAlignmentPanelActionConfig(id: string, title: ICommandActionTitle, shortLabel: string, alignment: PanelAlignment): PanelActionConfig<PanelAlignment> {
	return createPanelActionConfig<PanelAlignment>(id, title, shortLabel, alignment, PanelAlignmentContext.notEqualsTo(alignment));
}

const PositionPanelActionConfigs: PanelActionConfig<Position>[] = [
	createPositionPanelActionConfig(PositionPanelActionId.TOP, localize2('positionPanelTop', "Move Panel To Top"), localize('positionPanelTopShort', "Top"), Position.TOP),
	createPositionPanelActionConfig(PositionPanelActionId.LEFT, localize2('positionPanelLeft', "Move Panel Left"), localize('positionPanelLeftShort', "Left"), Position.LEFT),
	createPositionPanelActionConfig(PositionPanelActionId.RIGHT, localize2('positionPanelRight', "Move Panel Right"), localize('positionPanelRightShort', "Right"), Position.RIGHT),
	createPositionPanelActionConfig(PositionPanelActionId.BOTTOM, localize2('positionPanelBottom', "Move Panel To Bottom"), localize('positionPanelBottomShort', "Bottom"), Position.BOTTOM),
];


const AlignPanelActionConfigs: PanelActionConfig<PanelAlignment>[] = [
	createAlignmentPanelActionConfig(AlignPanelActionId.LEFT, localize2('alignPanelLeft', "Set Panel Alignment to Left"), localize('alignPanelLeftShort', "Left"), 'left'),
	createAlignmentPanelActionConfig(AlignPanelActionId.RIGHT, localize2('alignPanelRight', "Set Panel Alignment to Right"), localize('alignPanelRightShort', "Right"), 'right'),
	createAlignmentPanelActionConfig(AlignPanelActionId.CENTER, localize2('alignPanelCenter', "Set Panel Alignment to Center"), localize('alignPanelCenterShort', "Center"), 'center'),
	createAlignmentPanelActionConfig(AlignPanelActionId.JUSTIFY, localize2('alignPanelJustify', "Set Panel Alignment to Justify"), localize('alignPanelJustifyShort', "Justify"), 'justify'),
];

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	submenu: MenuId.PanelPositionMenu,
	title: localize('positionPanel', "Panel Position"),
	group: '3_workbench_layout_move',
	order: 4
});

PositionPanelActionConfigs.forEach((positionPanelAction, index) => {
	const { id, title, shortLabel, value, when } = positionPanelAction;

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id,
				title,
				category: Categories.View,
				f1: true
			});
		}
		run(accessor: ServicesAccessor): void {
			const layoutService = accessor.get(IWorkbenchLayoutService);
			layoutService.setPanelPosition(value === undefined ? Position.BOTTOM : value);
		}
	});

	MenuRegistry.appendMenuItem(MenuId.PanelPositionMenu, {
		command: {
			id,
			title: shortLabel,
			toggled: when.negate()
		},
		order: 5 + index
	});
});

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	submenu: MenuId.PanelAlignmentMenu,
	title: localize('alignPanel', "Align Panel"),
	group: '3_workbench_layout_move',
	order: 5
});

AlignPanelActionConfigs.forEach(alignPanelAction => {
	const { id, title, shortLabel, value, when } = alignPanelAction;
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id,
				title,
				category: Categories.View,
				toggled: when.negate(),
				f1: true
			});
		}
		run(accessor: ServicesAccessor): void {
			const layoutService = accessor.get(IWorkbenchLayoutService);
			layoutService.setPanelAlignment(value === undefined ? 'center' : value);
		}
	});

	MenuRegistry.appendMenuItem(MenuId.PanelAlignmentMenu, {
		command: {
			id,
			title: shortLabel,
			toggled: when.negate()
		},
		order: 5
	});
});

registerAction2(class extends SwitchCompositeViewAction {
	constructor() {
		super({
			id: 'workbench.action.previousPanelView',
			title: localize2('previousPanelView', "Previous Panel View"),
			category: Categories.View,
			f1: true
		}, ViewContainerLocation.Panel, -1);
	}
});

registerAction2(class extends SwitchCompositeViewAction {
	constructor() {
		super({
			id: 'workbench.action.nextPanelView',
			title: localize2('nextPanelView', "Next Panel View"),
			category: Categories.View,
			f1: true
		}, ViewContainerLocation.Panel, 1);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.toggleMaximizedPanel',
			title: localize2('toggleMaximizedPanel', 'Toggle Maximized Panel'),
			tooltip: localize('maximizePanel', "Maximize Panel Size"),
			category: Categories.View,
			f1: true,
			icon: maximizeIcon,
			// the workbench grid currently prevents us from supporting panel maximization with non-center panel alignment
			precondition: ContextKeyExpr.or(PanelAlignmentContext.isEqualTo('center'), ContextKeyExpr.and(PanelPositionContext.notEqualsTo('bottom'), PanelPositionContext.notEqualsTo('top'))),
			// --- Start Positron ---
			toggled: { condition: PanelMaximizedContext, icon: maximizeIcon, tooltip: localize('restoresPanel', "Restore Panel Size") },
			menu: [{
				id: MenuId.PanelTitle,
				group: 'navigation',
				order: 100,
				// the workbench grid currently prevents us from supporting panel maximization with non-center panel alignment
				when: PanelPositionContext.notEqualsTo('bottom') //when: ContextKeyExpr.or(PanelAlignmentContext.isEqualTo('center'), ContextKeyExpr.and(PanelPositionContext.notEqualsTo('bottom'), PanelPositionContext.notEqualsTo('top')))
			}]
			// --- End Positron ---
		});
	}
	run(accessor: ServicesAccessor) {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const notificationService = accessor.get(INotificationService);
		if (layoutService.getPanelAlignment() !== 'center' && isHorizontal(layoutService.getPanelPosition())) {
			notificationService.warn(localize('panelMaxNotSupported', "Maximizing the panel is only supported when it is center aligned."));
			return;
		}

		if (!layoutService.isVisible(Parts.PANEL_PART)) {
			layoutService.setPartHidden(false, Parts.PANEL_PART);
			// If the panel is not already maximized, maximize it
			if (!layoutService.isPanelMaximized()) {
				layoutService.toggleMaximizedPanel();
			}
		}
		else {
			layoutService.toggleMaximizedPanel();
		}
	}
});

// --- Start Positron ---
/**
 * Positron minimize panel action.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.minimizePanel',
			title: { value: localize('positron.minimizePanel', "Minimize Panel"), original: 'Minimizes Panel' },
			tooltip: localize('positron.minimizePanel', "Minimize Panel"),
			category: Categories.View,
			f1: true,
			icon: positronMinimizePanelIcon,
			// This action is only enabled when the panel position is bottom and the panel alignment
			// is center.
			precondition: ContextKeyExpr.and(PanelPositionContext.isEqualTo('bottom'), PanelAlignmentContext.isEqualTo('center')),
			menu: [{
				id: MenuId.PanelTitle,
				group: 'navigation',
				order: 1,
				// This navigation icon is only enabled when the panel position is bottom and the
				// panel alignment is center.
				when: ContextKeyExpr.and(PanelPositionContext.isEqualTo('bottom'), PanelAlignmentContext.isEqualTo('center'))
			}]
		});
	}

	run(accessor: ServicesAccessor) {
		// Access services.
		const layoutService = accessor.get(IWorkbenchLayoutService);

		// If the panel part isn't visible, unhide it.
		if (!layoutService.isVisible(Parts.PANEL_PART)) {
			// Unhide the panel part.
			layoutService.setPartHidden(false, Parts.PANEL_PART);
		}

		// Have the layout service minimize the panel.
		layoutService.minimizePanel();
	}
});

/**
 * Positron restore panel action.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.restorePanel',
			title: { value: localize('positron.restorePanel', "Restore Panel"), original: 'Restore Panel' },
			tooltip: localize('positron.restorePanel', "Restore Panel"),
			category: Categories.View,
			f1: true,
			icon: positronRestorePanelIcon,
			// This action is only enabled when the panel position is bottom and the panel alignment
			// is center.
			precondition: ContextKeyExpr.and(PanelPositionContext.isEqualTo('bottom'), PanelAlignmentContext.isEqualTo('center')),
			menu: [{
				id: MenuId.PanelTitle,
				group: 'navigation',
				order: 2,
				// This navigation icon is only enabled when the panel position is bottom and the
				// panel alignment is center.
				when: ContextKeyExpr.and(PanelPositionContext.isEqualTo('bottom'), PanelAlignmentContext.isEqualTo('center'))
			}]
		});
	}

	run(accessor: ServicesAccessor) {
		// Access services.
		const layoutService = accessor.get(IWorkbenchLayoutService);

		// If the panel part isn't visible, unhide it.
		if (!layoutService.isVisible(Parts.PANEL_PART)) {
			// Unhide the panel part.
			layoutService.setPartHidden(false, Parts.PANEL_PART);
		}

		// Have the layout service restore the panel.
		layoutService.restorePanel();
	}
});

/**
 * Positron maximize panel action.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.maximizePanel',
			title: { value: localize('positron.maximizePanel', "Maximize Panel"), original: 'Maximize Panel' },
			tooltip: localize('positron.maximizePanel', "Maximize Panel"),
			category: Categories.View,
			f1: true,
			icon: positronMaximizePanelIcon,
			// This action is only enabled when the panel position is bottom and the panel alignment
			// is center.
			precondition: ContextKeyExpr.and(PanelPositionContext.isEqualTo('bottom'), PanelAlignmentContext.isEqualTo('center')),
			menu: [{
				id: MenuId.PanelTitle,
				group: 'navigation',
				order: 3,
				// This navigation icon is only enabled when the panel position is bottom and the
				// panel alignment is center.
				when: ContextKeyExpr.and(PanelPositionContext.isEqualTo('bottom'), PanelAlignmentContext.isEqualTo('center'))
			}]
		});
	}

	run(accessor: ServicesAccessor) {
		// Access services.
		const layoutService = accessor.get(IWorkbenchLayoutService);

		// If the panel part isn't visible, unhide it.
		if (!layoutService.isVisible(Parts.PANEL_PART)) {
			// Unhide the panel part.
			layoutService.setPartHidden(false, Parts.PANEL_PART);
		}

		// Have the layout service maximize the panel.
		layoutService.maximizePanel();
	}
});
// --- End Positron ---

MenuRegistry.appendMenuItems([
	{
		id: MenuId.LayoutControlMenu,
		item: {
			group: '2_pane_toggles',
			command: {
				id: TogglePanelAction.ID,
				title: localize('togglePanel', "Toggle Panel"),
				icon: panelOffIcon,
				toggled: { condition: PanelVisibleContext, icon: panelIcon }
			},
			when:
				ContextKeyExpr.and(
					IsAuxiliaryWindowContext.negate(),
					ContextKeyExpr.or(
						ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
						ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both')
					)
				),
			order: 1
		}
	}
]);

class MoveViewsBetweenPanelsAction extends Action2 {
	constructor(private readonly source: ViewContainerLocation, private readonly destination: ViewContainerLocation, desc: Readonly<IAction2Options>) {
		super(desc);
	}

	run(accessor: ServicesAccessor, ...args: any[]): void {
		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const viewsService = accessor.get(IViewsService);

		const srcContainers = viewDescriptorService.getViewContainersByLocation(this.source);
		const destContainers = viewDescriptorService.getViewContainersByLocation(this.destination);

		if (srcContainers.length) {
			const activeViewContainer = viewsService.getVisibleViewContainer(this.source);

			srcContainers.forEach(viewContainer => viewDescriptorService.moveViewContainerToLocation(viewContainer, this.destination, undefined, this.desc.id));
			layoutService.setPartHidden(false, this.destination === ViewContainerLocation.Panel ? Parts.PANEL_PART : Parts.AUXILIARYBAR_PART);

			if (activeViewContainer && destContainers.length === 0) {
				viewsService.openViewContainer(activeViewContainer.id, true);
			}
		}
	}
}

// --- Move Panel Views To Secondary Side Bar

class MovePanelToSidePanelAction extends MoveViewsBetweenPanelsAction {
	static readonly ID = 'workbench.action.movePanelToSidePanel';
	constructor() {
		super(ViewContainerLocation.Panel, ViewContainerLocation.AuxiliaryBar, {
			id: MovePanelToSidePanelAction.ID,
			title: localize2('movePanelToSecondarySideBar', "Move Panel Views To Secondary Side Bar"),
			category: Categories.View,
			f1: false
		});
	}
}

export class MovePanelToSecondarySideBarAction extends MoveViewsBetweenPanelsAction {
	static readonly ID = 'workbench.action.movePanelToSecondarySideBar';
	constructor() {
		super(ViewContainerLocation.Panel, ViewContainerLocation.AuxiliaryBar, {
			id: MovePanelToSecondarySideBarAction.ID,
			title: localize2('movePanelToSecondarySideBar', "Move Panel Views To Secondary Side Bar"),
			category: Categories.View,
			f1: true
		});
	}
}

registerAction2(MovePanelToSidePanelAction);
registerAction2(MovePanelToSecondarySideBarAction);

// --- Move Secondary Side Bar Views To Panel

class MoveSidePanelToPanelAction extends MoveViewsBetweenPanelsAction {
	static readonly ID = 'workbench.action.moveSidePanelToPanel';

	constructor() {
		super(ViewContainerLocation.AuxiliaryBar, ViewContainerLocation.Panel, {
			id: MoveSidePanelToPanelAction.ID,
			title: localize2('moveSidePanelToPanel', "Move Secondary Side Bar Views To Panel"),
			category: Categories.View,
			f1: false
		});
	}
}

export class MoveSecondarySideBarToPanelAction extends MoveViewsBetweenPanelsAction {
	static readonly ID = 'workbench.action.moveSecondarySideBarToPanel';

	constructor() {
		super(ViewContainerLocation.AuxiliaryBar, ViewContainerLocation.Panel, {
			id: MoveSecondarySideBarToPanelAction.ID,
			title: localize2('moveSidePanelToPanel', "Move Secondary Side Bar Views To Panel"),
			category: Categories.View,
			f1: true
		});
	}
}
registerAction2(MoveSidePanelToPanelAction);
registerAction2(MoveSecondarySideBarToPanelAction);
