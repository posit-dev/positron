/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { registerColor, editorBackground, contrastBorder, transparent, editorWidgetBackground, textLinkForeground, lighten, darken, focusBorder, activeContrastBorder, editorWidgetForeground, editorErrorForeground, editorWarningForeground, editorInfoForeground, treeIndentGuidesStroke, errorForeground, listActiveSelectionBackground, listActiveSelectionForeground, editorForeground, toolbarHoverBackground, inputBorder, widgetBorder } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme } from 'vs/platform/theme/common/themeService';
import { Color } from 'vs/base/common/color';
import { ColorScheme } from 'vs/platform/theme/common/theme';

// --- Start Positron ---
import { // eslint-disable-line no-duplicate-imports
	foreground,
	disabledForeground,
	// secondaryBackground,
	buttonBackground,
	buttonForeground,
	buttonSecondaryBackground,
	buttonSecondaryForeground,
	checkboxBorder,
	checkboxForeground,
	checkboxBackground,
	inputBackground,
	listHoverBackground,
	listHoverForeground,
	listInactiveSelectionBackground,
	listInactiveSelectionForeground,
	tableColumnsBorder,
	selectBorder
} from 'vs/platform/theme/common/colorRegistry';
// --- End Positron ---

// < --- Workbench (not customizable) --- >

export function WORKBENCH_BACKGROUND(theme: IColorTheme): Color {
	switch (theme.type) {
		case ColorScheme.LIGHT:
			return Color.fromHex('#F3F3F3');
		case ColorScheme.HIGH_CONTRAST_LIGHT:
			return Color.fromHex('#FFFFFF');
		case ColorScheme.HIGH_CONTRAST_DARK:
			return Color.fromHex('#000000');
		default:
			return Color.fromHex('#252526');
	}
}

// < --- Tabs --- >

//#region Tab Background

export const TAB_ACTIVE_BACKGROUND = registerColor('tab.activeBackground', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('tabActiveBackground', "Active tab background color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_ACTIVE_BACKGROUND = registerColor('tab.unfocusedActiveBackground', {
	dark: TAB_ACTIVE_BACKGROUND,
	light: TAB_ACTIVE_BACKGROUND,
	hcDark: TAB_ACTIVE_BACKGROUND,
	hcLight: TAB_ACTIVE_BACKGROUND,
}, localize('tabUnfocusedActiveBackground', "Active tab background color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_INACTIVE_BACKGROUND = registerColor('tab.inactiveBackground', {
	dark: '#2D2D2D',
	light: '#ECECEC',
	hcDark: null,
	hcLight: null,
}, localize('tabInactiveBackground', "Inactive tab background color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_INACTIVE_BACKGROUND = registerColor('tab.unfocusedInactiveBackground', {
	dark: TAB_INACTIVE_BACKGROUND,
	light: TAB_INACTIVE_BACKGROUND,
	hcDark: TAB_INACTIVE_BACKGROUND,
	hcLight: TAB_INACTIVE_BACKGROUND
}, localize('tabUnfocusedInactiveBackground', "Inactive tab background color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

//#endregion

//#region Tab Foreground

export const TAB_ACTIVE_FOREGROUND = registerColor('tab.activeForeground', {
	dark: Color.white,
	light: '#333333',
	hcDark: Color.white,
	hcLight: '#292929'
}, localize('tabActiveForeground', "Active tab foreground color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_INACTIVE_FOREGROUND = registerColor('tab.inactiveForeground', {
	dark: transparent(TAB_ACTIVE_FOREGROUND, 0.5),
	light: transparent(TAB_ACTIVE_FOREGROUND, 0.7),
	hcDark: Color.white,
	hcLight: '#292929'
}, localize('tabInactiveForeground', "Inactive tab foreground color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_ACTIVE_FOREGROUND = registerColor('tab.unfocusedActiveForeground', {
	dark: transparent(TAB_ACTIVE_FOREGROUND, 0.5),
	light: transparent(TAB_ACTIVE_FOREGROUND, 0.7),
	hcDark: Color.white,
	hcLight: '#292929'
}, localize('tabUnfocusedActiveForeground', "Active tab foreground color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_INACTIVE_FOREGROUND = registerColor('tab.unfocusedInactiveForeground', {
	dark: transparent(TAB_INACTIVE_FOREGROUND, 0.5),
	light: transparent(TAB_INACTIVE_FOREGROUND, 0.5),
	hcDark: Color.white,
	hcLight: '#292929'
}, localize('tabUnfocusedInactiveForeground', "Inactive tab foreground color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

//#endregion

//#region Tab Hover Foreground/Background

export const TAB_HOVER_BACKGROUND = registerColor('tab.hoverBackground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('tabHoverBackground', "Tab background color when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_HOVER_BACKGROUND = registerColor('tab.unfocusedHoverBackground', {
	dark: transparent(TAB_HOVER_BACKGROUND, 0.5),
	light: transparent(TAB_HOVER_BACKGROUND, 0.7),
	hcDark: null,
	hcLight: null
}, localize('tabUnfocusedHoverBackground', "Tab background color in an unfocused group when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_HOVER_FOREGROUND = registerColor('tab.hoverForeground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null,
}, localize('tabHoverForeground', "Tab foreground color when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_HOVER_FOREGROUND = registerColor('tab.unfocusedHoverForeground', {
	dark: transparent(TAB_HOVER_FOREGROUND, 0.5),
	light: transparent(TAB_HOVER_FOREGROUND, 0.5),
	hcDark: null,
	hcLight: null
}, localize('tabUnfocusedHoverForeground', "Tab foreground color in an unfocused group when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

//#endregion

//#region Tab Borders

export const TAB_BORDER = registerColor('tab.border', {
	dark: '#252526',
	light: '#F3F3F3',
	hcDark: contrastBorder,
	hcLight: contrastBorder,
}, localize('tabBorder', "Border to separate tabs from each other. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_LAST_PINNED_BORDER = registerColor('tab.lastPinnedBorder', {
	dark: treeIndentGuidesStroke,
	light: treeIndentGuidesStroke,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('lastPinnedTabBorder', "Border to separate pinned tabs from other tabs. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_ACTIVE_BORDER = registerColor('tab.activeBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('tabActiveBorder', "Border on the bottom of an active tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_ACTIVE_BORDER = registerColor('tab.unfocusedActiveBorder', {
	dark: transparent(TAB_ACTIVE_BORDER, 0.5),
	light: transparent(TAB_ACTIVE_BORDER, 0.7),
	hcDark: null,
	hcLight: null
}, localize('tabActiveUnfocusedBorder', "Border on the bottom of an active tab in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_ACTIVE_BORDER_TOP = registerColor('tab.activeBorderTop', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: '#B5200D'
}, localize('tabActiveBorderTop', "Border to the top of an active tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_ACTIVE_BORDER_TOP = registerColor('tab.unfocusedActiveBorderTop', {
	dark: transparent(TAB_ACTIVE_BORDER_TOP, 0.5),
	light: transparent(TAB_ACTIVE_BORDER_TOP, 0.7),
	hcDark: null,
	hcLight: '#B5200D'
}, localize('tabActiveUnfocusedBorderTop', "Border to the top of an active tab in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_HOVER_BORDER = registerColor('tab.hoverBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('tabHoverBorder', "Border to highlight tabs when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_HOVER_BORDER = registerColor('tab.unfocusedHoverBorder', {
	dark: transparent(TAB_HOVER_BORDER, 0.5),
	light: transparent(TAB_HOVER_BORDER, 0.7),
	hcDark: null,
	hcLight: contrastBorder
}, localize('tabUnfocusedHoverBorder', "Border to highlight tabs in an unfocused group when hovering. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

//#endregion

//#region Tab Modified Border

export const TAB_ACTIVE_MODIFIED_BORDER = registerColor('tab.activeModifiedBorder', {
	dark: '#3399CC',
	light: '#33AAEE',
	hcDark: null,
	hcLight: contrastBorder
}, localize('tabActiveModifiedBorder', "Border on the top of modified active tabs in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_INACTIVE_MODIFIED_BORDER = registerColor('tab.inactiveModifiedBorder', {
	dark: transparent(TAB_ACTIVE_MODIFIED_BORDER, 0.5),
	light: transparent(TAB_ACTIVE_MODIFIED_BORDER, 0.5),
	hcDark: Color.white,
	hcLight: contrastBorder
}, localize('tabInactiveModifiedBorder', "Border on the top of modified inactive tabs in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER = registerColor('tab.unfocusedActiveModifiedBorder', {
	dark: transparent(TAB_ACTIVE_MODIFIED_BORDER, 0.5),
	light: transparent(TAB_ACTIVE_MODIFIED_BORDER, 0.7),
	hcDark: Color.white,
	hcLight: contrastBorder
}, localize('unfocusedActiveModifiedBorder', "Border on the top of modified active tabs in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

export const TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER = registerColor('tab.unfocusedInactiveModifiedBorder', {
	dark: transparent(TAB_INACTIVE_MODIFIED_BORDER, 0.5),
	light: transparent(TAB_INACTIVE_MODIFIED_BORDER, 0.5),
	hcDark: Color.white,
	hcLight: contrastBorder
}, localize('unfocusedINactiveModifiedBorder', "Border on the top of modified inactive tabs in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups."));

//#endregion

// < --- Editors --- >

export const EDITOR_PANE_BACKGROUND = registerColor('editorPane.background', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('editorPaneBackground', "Background color of the editor pane visible on the left and right side of the centered editor layout."));

export const EDITOR_GROUP_EMPTY_BACKGROUND = registerColor('editorGroup.emptyBackground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('editorGroupEmptyBackground', "Background color of an empty editor group. Editor groups are the containers of editors."));

export const EDITOR_GROUP_FOCUSED_EMPTY_BORDER = registerColor('editorGroup.focusedEmptyBorder', {
	dark: null,
	light: null,
	hcDark: focusBorder,
	hcLight: focusBorder
}, localize('editorGroupFocusedEmptyBorder', "Border color of an empty editor group that is focused. Editor groups are the containers of editors."));

export const EDITOR_GROUP_HEADER_TABS_BACKGROUND = registerColor('editorGroupHeader.tabsBackground', {
	dark: '#252526',
	light: '#F3F3F3',
	hcDark: null,
	hcLight: null
}, localize('tabsContainerBackground', "Background color of the editor group title header when tabs are enabled. Editor groups are the containers of editors."));

export const EDITOR_GROUP_HEADER_TABS_BORDER = registerColor('editorGroupHeader.tabsBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('tabsContainerBorder', "Border color of the editor group title header when tabs are enabled. Editor groups are the containers of editors."));

export const EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND = registerColor('editorGroupHeader.noTabsBackground', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('editorGroupHeaderBackground', "Background color of the editor group title header when (`\"workbench.editor.showTabs\": \"single\"`). Editor groups are the containers of editors."));

export const EDITOR_GROUP_HEADER_BORDER = registerColor('editorGroupHeader.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('editorTitleContainerBorder', "Border color of the editor group title header. Editor groups are the containers of editors."));

export const EDITOR_GROUP_BORDER = registerColor('editorGroup.border', {
	dark: '#444444',
	light: '#E7E7E7',
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('editorGroupBorder', "Color to separate multiple editor groups from each other. Editor groups are the containers of editors."));

export const EDITOR_DRAG_AND_DROP_BACKGROUND = registerColor('editorGroup.dropBackground', {
	dark: Color.fromHex('#53595D').transparent(0.5),
	light: Color.fromHex('#2677CB').transparent(0.18),
	hcDark: null,
	hcLight: Color.fromHex('#0F4A85').transparent(0.50)
}, localize('editorDragAndDropBackground', "Background color when dragging editors around. The color should have transparency so that the editor contents can still shine through."));

export const EDITOR_DROP_INTO_PROMPT_FOREGROUND = registerColor('editorGroup.dropIntoPromptForeground', {
	dark: editorWidgetForeground,
	light: editorWidgetForeground,
	hcDark: editorWidgetForeground,
	hcLight: editorWidgetForeground
}, localize('editorDropIntoPromptForeground', "Foreground color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor."));

export const EDITOR_DROP_INTO_PROMPT_BACKGROUND = registerColor('editorGroup.dropIntoPromptBackground', {
	dark: editorWidgetBackground,
	light: editorWidgetBackground,
	hcDark: editorWidgetBackground,
	hcLight: editorWidgetBackground
}, localize('editorDropIntoPromptBackground', "Background color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor."));

export const EDITOR_DROP_INTO_PROMPT_BORDER = registerColor('editorGroup.dropIntoPromptBorder', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('editorDropIntoPromptBorder', "Border color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor."));

export const SIDE_BY_SIDE_EDITOR_HORIZONTAL_BORDER = registerColor('sideBySideEditor.horizontalBorder', {
	dark: EDITOR_GROUP_BORDER,
	light: EDITOR_GROUP_BORDER,
	hcDark: EDITOR_GROUP_BORDER,
	hcLight: EDITOR_GROUP_BORDER
}, localize('sideBySideEditor.horizontalBorder', "Color to separate two editors from each other when shown side by side in an editor group from top to bottom."));

export const SIDE_BY_SIDE_EDITOR_VERTICAL_BORDER = registerColor('sideBySideEditor.verticalBorder', {
	dark: EDITOR_GROUP_BORDER,
	light: EDITOR_GROUP_BORDER,
	hcDark: EDITOR_GROUP_BORDER,
	hcLight: EDITOR_GROUP_BORDER
}, localize('sideBySideEditor.verticalBorder', "Color to separate two editors from each other when shown side by side in an editor group from left to right."));

// < --- Panels --- >

// --- Start Positron ---
// Added panel header background that matches the sidebar background.
export const PANEL_HEADER_BACKGROUND = registerColor('panel.headerBackground', {
	dark: 'sideBar.background',
	light: 'sideBar.background',
	hcDark: 'sideBar.background',
	hcLight: 'sideBar.background'
}, localize('panel.headerBackground', "Panel header background color. Panels are shown below the editor area and contain views like output and integrated terminal."));
// --- End Positron ---

export const PANEL_BACKGROUND = registerColor('panel.background', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('panelBackground', "Panel background color. Panels are shown below the editor area and contain views like output and integrated terminal."));

export const PANEL_BORDER = registerColor('panel.border', {
	dark: Color.fromHex('#808080').transparent(0.35),
	light: Color.fromHex('#808080').transparent(0.35),
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('panelBorder', "Panel border color to separate the panel from the editor. Panels are shown below the editor area and contain views like output and integrated terminal."));

export const PANEL_ACTIVE_TITLE_FOREGROUND = registerColor('panelTitle.activeForeground', {
	dark: '#E7E7E7',
	light: '#424242',
	hcDark: Color.white,
	hcLight: editorForeground
}, localize('panelActiveTitleForeground', "Title color for the active panel. Panels are shown below the editor area and contain views like output and integrated terminal."));

export const PANEL_INACTIVE_TITLE_FOREGROUND = registerColor('panelTitle.inactiveForeground', {
	dark: transparent(PANEL_ACTIVE_TITLE_FOREGROUND, 0.6),
	light: transparent(PANEL_ACTIVE_TITLE_FOREGROUND, 0.75),
	hcDark: Color.white,
	hcLight: editorForeground
}, localize('panelInactiveTitleForeground', "Title color for the inactive panel. Panels are shown below the editor area and contain views like output and integrated terminal."));

export const PANEL_ACTIVE_TITLE_BORDER = registerColor('panelTitle.activeBorder', {
	dark: PANEL_ACTIVE_TITLE_FOREGROUND,
	light: PANEL_ACTIVE_TITLE_FOREGROUND,
	hcDark: contrastBorder,
	hcLight: '#B5200D'
}, localize('panelActiveTitleBorder', "Border color for the active panel title. Panels are shown below the editor area and contain views like output and integrated terminal."));

export const PANEL_INPUT_BORDER = registerColor('panelInput.border', {
	dark: inputBorder,
	light: Color.fromHex('#ddd'),
	hcDark: inputBorder,
	hcLight: inputBorder
}, localize('panelInputBorder', "Input box border for inputs in the panel."));

export const PANEL_DRAG_AND_DROP_BORDER = registerColor('panel.dropBorder', {
	dark: PANEL_ACTIVE_TITLE_FOREGROUND,
	light: PANEL_ACTIVE_TITLE_FOREGROUND,
	hcDark: PANEL_ACTIVE_TITLE_FOREGROUND,
	hcLight: PANEL_ACTIVE_TITLE_FOREGROUND
}, localize('panelDragAndDropBorder', "Drag and drop feedback color for the panel titles. Panels are shown below the editor area and contain views like output and integrated terminal."));

export const PANEL_SECTION_DRAG_AND_DROP_BACKGROUND = registerColor('panelSection.dropBackground', {
	dark: EDITOR_DRAG_AND_DROP_BACKGROUND,
	light: EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcDark: EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcLight: EDITOR_DRAG_AND_DROP_BACKGROUND
}, localize('panelSectionDragAndDropBackground', "Drag and drop feedback color for the panel sections. The color should have transparency so that the panel sections can still shine through. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));

export const PANEL_SECTION_HEADER_BACKGROUND = registerColor('panelSectionHeader.background', {
	dark: Color.fromHex('#808080').transparent(0.2),
	light: Color.fromHex('#808080').transparent(0.2),
	hcDark: null,
	hcLight: null,
}, localize('panelSectionHeaderBackground', "Panel section header background color. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));

export const PANEL_SECTION_HEADER_FOREGROUND = registerColor('panelSectionHeader.foreground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('panelSectionHeaderForeground', "Panel section header foreground color. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));

export const PANEL_SECTION_HEADER_BORDER = registerColor('panelSectionHeader.border', {
	dark: contrastBorder,
	light: contrastBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('panelSectionHeaderBorder', "Panel section header border color used when multiple views are stacked vertically in the panel. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));

export const PANEL_SECTION_BORDER = registerColor('panelSection.border', {
	dark: PANEL_BORDER,
	light: PANEL_BORDER,
	hcDark: PANEL_BORDER,
	hcLight: PANEL_BORDER
}, localize('panelSectionBorder', "Panel section border color used when multiple views are stacked horizontally in the panel. Panels are shown below the editor area and contain views like output and integrated terminal. Panel sections are views nested within the panels."));

// < --- Output Editor -->

const OUTPUT_VIEW_BACKGROUND = registerColor('outputView.background', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('outputViewBackground', "Output view background color."));


registerColor('outputViewStickyScroll.background', {
	dark: OUTPUT_VIEW_BACKGROUND,
	light: OUTPUT_VIEW_BACKGROUND,
	hcDark: OUTPUT_VIEW_BACKGROUND,
	hcLight: OUTPUT_VIEW_BACKGROUND
}, localize('outputViewStickyScrollBackground', "Output view sticky scroll background color."));


// < --- Banner --- >

export const BANNER_BACKGROUND = registerColor('banner.background', {
	dark: listActiveSelectionBackground,
	light: darken(listActiveSelectionBackground, 0.3),
	hcDark: listActiveSelectionBackground,
	hcLight: listActiveSelectionBackground
}, localize('banner.background', "Banner background color. The banner is shown under the title bar of the window."));

export const BANNER_FOREGROUND = registerColor('banner.foreground', {
	dark: listActiveSelectionForeground,
	light: listActiveSelectionForeground,
	hcDark: listActiveSelectionForeground,
	hcLight: listActiveSelectionForeground
}, localize('banner.foreground', "Banner foreground color. The banner is shown under the title bar of the window."));

export const BANNER_ICON_FOREGROUND = registerColor('banner.iconForeground', {
	dark: editorInfoForeground,
	light: editorInfoForeground,
	hcDark: editorInfoForeground,
	hcLight: editorInfoForeground
}, localize('banner.iconForeground', "Banner icon color. The banner is shown under the title bar of the window."));

// < --- Status --- >

export const STATUS_BAR_FOREGROUND = registerColor('statusBar.foreground', {
	dark: '#FFFFFF',
	light: '#FFFFFF',
	hcDark: '#FFFFFF',
	hcLight: editorForeground
}, localize('statusBarForeground', "Status bar foreground color when a workspace or folder is opened. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_NO_FOLDER_FOREGROUND = registerColor('statusBar.noFolderForeground', {
	dark: STATUS_BAR_FOREGROUND,
	light: STATUS_BAR_FOREGROUND,
	hcDark: STATUS_BAR_FOREGROUND,
	hcLight: STATUS_BAR_FOREGROUND
}, localize('statusBarNoFolderForeground', "Status bar foreground color when no folder is opened. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_BACKGROUND = registerColor('statusBar.background', {
	dark: '#007ACC',
	light: '#007ACC',
	hcDark: null,
	hcLight: null,
}, localize('statusBarBackground', "Status bar background color when a workspace or folder is opened. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_NO_FOLDER_BACKGROUND = registerColor('statusBar.noFolderBackground', {
	dark: '#68217A',
	light: '#68217A',
	hcDark: null,
	hcLight: null,
}, localize('statusBarNoFolderBackground', "Status bar background color when no folder is opened. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_BORDER = registerColor('statusBar.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('statusBarBorder', "Status bar border color separating to the sidebar and editor. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_FOCUS_BORDER = registerColor('statusBar.focusBorder', {
	dark: STATUS_BAR_FOREGROUND,
	light: STATUS_BAR_FOREGROUND,
	hcDark: null,
	hcLight: STATUS_BAR_FOREGROUND
}, localize('statusBarFocusBorder', "Status bar border color when focused on keyboard navigation. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_NO_FOLDER_BORDER = registerColor('statusBar.noFolderBorder', {
	dark: STATUS_BAR_BORDER,
	light: STATUS_BAR_BORDER,
	hcDark: STATUS_BAR_BORDER,
	hcLight: STATUS_BAR_BORDER
}, localize('statusBarNoFolderBorder', "Status bar border color separating to the sidebar and editor when no folder is opened. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ITEM_ACTIVE_BACKGROUND = registerColor('statusBarItem.activeBackground', {
	dark: Color.white.transparent(0.18),
	light: Color.white.transparent(0.18),
	hcDark: Color.white.transparent(0.18),
	hcLight: Color.black.transparent(0.18)
}, localize('statusBarItemActiveBackground', "Status bar item background color when clicking. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ITEM_FOCUS_BORDER = registerColor('statusBarItem.focusBorder', {
	dark: STATUS_BAR_FOREGROUND,
	light: STATUS_BAR_FOREGROUND,
	hcDark: null,
	hcLight: activeContrastBorder
}, localize('statusBarItemFocusBorder', "Status bar item border color when focused on keyboard navigation. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ITEM_HOVER_BACKGROUND = registerColor('statusBarItem.hoverBackground', {
	dark: Color.white.transparent(0.12),
	light: Color.white.transparent(0.12),
	hcDark: Color.white.transparent(0.12),
	hcLight: Color.black.transparent(0.12)
}, localize('statusBarItemHoverBackground', "Status bar item background color when hovering. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ITEM_HOVER_FOREGROUND = registerColor('statusBarItem.hoverForeground', {
	dark: STATUS_BAR_FOREGROUND,
	light: STATUS_BAR_FOREGROUND,
	hcDark: STATUS_BAR_FOREGROUND,
	hcLight: STATUS_BAR_FOREGROUND
}, localize('statusBarItemHoverForeground', "Status bar item foreground color when hovering. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND = registerColor('statusBarItem.compactHoverBackground', {
	dark: Color.white.transparent(0.20),
	light: Color.white.transparent(0.20),
	hcDark: Color.white.transparent(0.20),
	hcLight: Color.black.transparent(0.20)
}, localize('statusBarItemCompactHoverBackground', "Status bar item background color when hovering an item that contains two hovers. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_PROMINENT_ITEM_FOREGROUND = registerColor('statusBarItem.prominentForeground', {
	dark: STATUS_BAR_FOREGROUND,
	light: STATUS_BAR_FOREGROUND,
	hcDark: STATUS_BAR_FOREGROUND,
	hcLight: STATUS_BAR_FOREGROUND
}, localize('statusBarProminentItemForeground', "Status bar prominent items foreground color. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_PROMINENT_ITEM_BACKGROUND = registerColor('statusBarItem.prominentBackground', {
	dark: Color.black.transparent(0.5),
	light: Color.black.transparent(0.5),
	hcDark: Color.black.transparent(0.5),
	hcLight: Color.black.transparent(0.5),
}, localize('statusBarProminentItemBackground', "Status bar prominent items background color. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_PROMINENT_ITEM_HOVER_FOREGROUND = registerColor('statusBarItem.prominentHoverForeground', {
	dark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: STATUS_BAR_ITEM_HOVER_FOREGROUND
}, localize('statusBarProminentItemHoverForeground', "Status bar prominent items foreground color when hovering. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_PROMINENT_ITEM_HOVER_BACKGROUND = registerColor('statusBarItem.prominentHoverBackground', {
	dark: Color.black.transparent(0.3),
	light: Color.black.transparent(0.3),
	hcDark: Color.black.transparent(0.3),
	hcLight: null
}, localize('statusBarProminentItemHoverBackground', "Status bar prominent items background color when hovering. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ERROR_ITEM_BACKGROUND = registerColor('statusBarItem.errorBackground', {
	dark: darken(errorForeground, .4),
	light: darken(errorForeground, .4),
	hcDark: null,
	hcLight: '#B5200D'
}, localize('statusBarErrorItemBackground', "Status bar error items background color. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ERROR_ITEM_FOREGROUND = registerColor('statusBarItem.errorForeground', {
	dark: Color.white,
	light: Color.white,
	hcDark: Color.white,
	hcLight: Color.white
}, localize('statusBarErrorItemForeground', "Status bar error items foreground color. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ERROR_ITEM_HOVER_FOREGROUND = registerColor('statusBarItem.errorHoverForeground', {
	dark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: STATUS_BAR_ITEM_HOVER_FOREGROUND
}, localize('statusBarErrorItemHoverForeground', "Status bar error items foreground color when hovering. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_ERROR_ITEM_HOVER_BACKGROUND = registerColor('statusBarItem.errorHoverBackground', {
	dark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: STATUS_BAR_ITEM_HOVER_BACKGROUND
}, localize('statusBarErrorItemHoverBackground', "Status bar error items background color when hovering. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_WARNING_ITEM_BACKGROUND = registerColor('statusBarItem.warningBackground', {
	dark: darken(editorWarningForeground, .4),
	light: darken(editorWarningForeground, .4),
	hcDark: null,
	hcLight: '#895503'
}, localize('statusBarWarningItemBackground', "Status bar warning items background color. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_WARNING_ITEM_FOREGROUND = registerColor('statusBarItem.warningForeground', {
	dark: Color.white,
	light: Color.white,
	hcDark: Color.white,
	hcLight: Color.white
}, localize('statusBarWarningItemForeground', "Status bar warning items foreground color. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_WARNING_ITEM_HOVER_FOREGROUND = registerColor('statusBarItem.warningHoverForeground', {
	dark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: STATUS_BAR_ITEM_HOVER_FOREGROUND
}, localize('statusBarWarningItemHoverForeground', "Status bar warning items foreground color when hovering. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));

export const STATUS_BAR_WARNING_ITEM_HOVER_BACKGROUND = registerColor('statusBarItem.warningHoverBackground', {
	dark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: STATUS_BAR_ITEM_HOVER_BACKGROUND
}, localize('statusBarWarningItemHoverBackground', "Status bar warning items background color when hovering. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window."));


// < --- Activity Bar --- >

export const ACTIVITY_BAR_BACKGROUND = registerColor('activityBar.background', {
	dark: '#333333',
	light: '#2C2C2C',
	hcDark: '#000000',
	hcLight: '#FFFFFF'
}, localize('activityBarBackground', "Activity bar background color. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_FOREGROUND = registerColor('activityBar.foreground', {
	dark: Color.white,
	light: Color.white,
	hcDark: Color.white,
	hcLight: editorForeground
}, localize('activityBarForeground', "Activity bar item foreground color when it is active. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_INACTIVE_FOREGROUND = registerColor('activityBar.inactiveForeground', {
	dark: transparent(ACTIVITY_BAR_FOREGROUND, 0.4),
	light: transparent(ACTIVITY_BAR_FOREGROUND, 0.4),
	hcDark: Color.white,
	hcLight: editorForeground
}, localize('activityBarInActiveForeground', "Activity bar item foreground color when it is inactive. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_BORDER = registerColor('activityBar.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('activityBarBorder', "Activity bar border color separating to the side bar. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_ACTIVE_BORDER = registerColor('activityBar.activeBorder', {
	dark: ACTIVITY_BAR_FOREGROUND,
	light: ACTIVITY_BAR_FOREGROUND,
	hcDark: null,
	hcLight: contrastBorder
}, localize('activityBarActiveBorder', "Activity bar border color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_ACTIVE_FOCUS_BORDER = registerColor('activityBar.activeFocusBorder', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: '#B5200D'
}, localize('activityBarActiveFocusBorder', "Activity bar focus border color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_ACTIVE_BACKGROUND = registerColor('activityBar.activeBackground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('activityBarActiveBackground', "Activity bar background color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_DRAG_AND_DROP_BORDER = registerColor('activityBar.dropBorder', {
	dark: ACTIVITY_BAR_FOREGROUND,
	light: ACTIVITY_BAR_FOREGROUND,
	hcDark: null,
	hcLight: null,
}, localize('activityBarDragAndDropBorder', "Drag and drop feedback color for the activity bar items. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_BADGE_BACKGROUND = registerColor('activityBarBadge.background', {
	dark: '#007ACC',
	light: '#007ACC',
	hcDark: '#000000',
	hcLight: '#0F4A85'
}, localize('activityBarBadgeBackground', "Activity notification badge background color. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_BADGE_FOREGROUND = registerColor('activityBarBadge.foreground', {
	dark: Color.white,
	light: Color.white,
	hcDark: Color.white,
	hcLight: Color.white
}, localize('activityBarBadgeForeground', "Activity notification badge foreground color. The activity bar is showing on the far left or right and allows to switch between views of the side bar."));

export const ACTIVITY_BAR_TOP_FOREGROUND = registerColor('activityBarTop.foreground', {
	dark: '#E7E7E7',
	light: '#424242',
	hcDark: Color.white,
	hcLight: editorForeground
}, localize('activityBarTop', "Active foreground color of the item in the Activity bar when it is on top. The activity allows to switch between views of the side bar."));

export const ACTIVITY_BAR_TOP_ACTIVE_BORDER = registerColor('activityBarTop.activeBorder', {
	dark: ACTIVITY_BAR_TOP_FOREGROUND,
	light: ACTIVITY_BAR_TOP_FOREGROUND,
	hcDark: contrastBorder,
	hcLight: '#B5200D'
}, localize('activityBarTopActiveFocusBorder', "Focus border color for the active item in the Activity bar when it is on top. The activity allows to switch between views of the side bar."));

export const ACTIVITY_BAR_TOP_INACTIVE_FOREGROUND = registerColor('activityBarTop.inactiveForeground', {
	dark: transparent(ACTIVITY_BAR_TOP_FOREGROUND, 0.6),
	light: transparent(ACTIVITY_BAR_TOP_FOREGROUND, 0.75),
	hcDark: Color.white,
	hcLight: editorForeground
}, localize('activityBarTopInActiveForeground', "Inactive foreground color of the item in the Activity bar when it is on top. The activity allows to switch between views of the side bar."));

export const ACTIVITY_BAR_TOP_DRAG_AND_DROP_BORDER = registerColor('activityBarTop.dropBorder', {
	dark: ACTIVITY_BAR_TOP_FOREGROUND,
	light: ACTIVITY_BAR_TOP_FOREGROUND,
	hcDark: ACTIVITY_BAR_TOP_FOREGROUND,
	hcLight: ACTIVITY_BAR_TOP_FOREGROUND
}, localize('activityBarTopDragAndDropBorder', "Drag and drop feedback color for the items in the Activity bar when it is on top. The activity allows to switch between views of the side bar."));


// < --- Profiles --- >

export const PROFILE_BADGE_BACKGROUND = registerColor('profileBadge.background', {
	dark: '#4D4D4D',
	light: '#C4C4C4',
	hcDark: Color.white,
	hcLight: Color.black
}, localize('profileBadgeBackground', "Profile badge background color. The profile badge shows on top of the settings gear icon in the activity bar."));

export const PROFILE_BADGE_FOREGROUND = registerColor('profileBadge.foreground', {
	dark: Color.white,
	light: '#333333',
	hcDark: Color.black,
	hcLight: Color.white
}, localize('profileBadgeForeground', "Profile badge foreground color. The profile badge shows on top of the settings gear icon in the activity bar."));

// < --- Remote --- >

export const STATUS_BAR_REMOTE_ITEM_BACKGROUND = registerColor('statusBarItem.remoteBackground', {
	dark: ACTIVITY_BAR_BADGE_BACKGROUND,
	light: ACTIVITY_BAR_BADGE_BACKGROUND,
	hcDark: ACTIVITY_BAR_BADGE_BACKGROUND,
	hcLight: ACTIVITY_BAR_BADGE_BACKGROUND
}, localize('statusBarItemHostBackground', "Background color for the remote indicator on the status bar."));

export const STATUS_BAR_REMOTE_ITEM_FOREGROUND = registerColor('statusBarItem.remoteForeground', {
	dark: ACTIVITY_BAR_BADGE_FOREGROUND,
	light: ACTIVITY_BAR_BADGE_FOREGROUND,
	hcDark: ACTIVITY_BAR_BADGE_FOREGROUND,
	hcLight: ACTIVITY_BAR_BADGE_FOREGROUND
}, localize('statusBarItemHostForeground', "Foreground color for the remote indicator on the status bar."));

export const STATUS_BAR_REMOTE_ITEM_HOVER_FOREGROUND = registerColor('statusBarItem.remoteHoverForeground', {
	dark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: STATUS_BAR_ITEM_HOVER_FOREGROUND
}, localize('statusBarRemoteItemHoverForeground', "Foreground color for the remote indicator on the status bar when hovering."));

export const STATUS_BAR_REMOTE_ITEM_HOVER_BACKGROUND = registerColor('statusBarItem.remoteHoverBackground', {
	dark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: null
}, localize('statusBarRemoteItemHoverBackground', "Background color for the remote indicator on the status bar when hovering."));

export const STATUS_BAR_OFFLINE_ITEM_BACKGROUND = registerColor('statusBarItem.offlineBackground', {
	dark: '#6c1717',
	light: '#6c1717',
	hcDark: '#6c1717',
	hcLight: '#6c1717'
}, localize('statusBarItemOfflineBackground', "Status bar item background color when the workbench is offline."));

export const STATUS_BAR_OFFLINE_ITEM_FOREGROUND = registerColor('statusBarItem.offlineForeground', {
	dark: STATUS_BAR_REMOTE_ITEM_FOREGROUND,
	light: STATUS_BAR_REMOTE_ITEM_FOREGROUND,
	hcDark: STATUS_BAR_REMOTE_ITEM_FOREGROUND,
	hcLight: STATUS_BAR_REMOTE_ITEM_FOREGROUND
}, localize('statusBarItemOfflineForeground', "Status bar item foreground color when the workbench is offline."));

export const STATUS_BAR_OFFLINE_ITEM_HOVER_FOREGROUND = registerColor('statusBarItem.offlineHoverForeground', {
	dark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	light: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_FOREGROUND,
	hcLight: STATUS_BAR_ITEM_HOVER_FOREGROUND
}, localize('statusBarOfflineItemHoverForeground', "Status bar item foreground hover color when the workbench is offline."));

export const STATUS_BAR_OFFLINE_ITEM_HOVER_BACKGROUND = registerColor('statusBarItem.offlineHoverBackground', {
	dark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	light: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcDark: STATUS_BAR_ITEM_HOVER_BACKGROUND,
	hcLight: null
}, localize('statusBarOfflineItemHoverBackground', "Status bar item background hover color when the workbench is offline."));

export const EXTENSION_BADGE_REMOTE_BACKGROUND = registerColor('extensionBadge.remoteBackground', {
	dark: ACTIVITY_BAR_BADGE_BACKGROUND,
	light: ACTIVITY_BAR_BADGE_BACKGROUND,
	hcDark: ACTIVITY_BAR_BADGE_BACKGROUND,
	hcLight: ACTIVITY_BAR_BADGE_BACKGROUND
}, localize('extensionBadge.remoteBackground', "Background color for the remote badge in the extensions view."));

export const EXTENSION_BADGE_REMOTE_FOREGROUND = registerColor('extensionBadge.remoteForeground', {
	dark: ACTIVITY_BAR_BADGE_FOREGROUND,
	light: ACTIVITY_BAR_BADGE_FOREGROUND,
	hcDark: ACTIVITY_BAR_BADGE_FOREGROUND,
	hcLight: ACTIVITY_BAR_BADGE_FOREGROUND
}, localize('extensionBadge.remoteForeground', "Foreground color for the remote badge in the extensions view."));


// < --- Side Bar --- >

export const SIDE_BAR_BACKGROUND = registerColor('sideBar.background', {
	dark: '#252526',
	light: '#F3F3F3',
	hcDark: '#000000',
	hcLight: '#FFFFFF'
}, localize('sideBarBackground', "Side bar background color. The side bar is the container for views like explorer and search."));

export const SIDE_BAR_FOREGROUND = registerColor('sideBar.foreground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('sideBarForeground', "Side bar foreground color. The side bar is the container for views like explorer and search."));

export const SIDE_BAR_BORDER = registerColor('sideBar.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('sideBarBorder', "Side bar border color on the side separating to the editor. The side bar is the container for views like explorer and search."));

export const SIDE_BAR_TITLE_FOREGROUND = registerColor('sideBarTitle.foreground', {
	dark: SIDE_BAR_FOREGROUND,
	light: SIDE_BAR_FOREGROUND,
	hcDark: SIDE_BAR_FOREGROUND,
	hcLight: SIDE_BAR_FOREGROUND
}, localize('sideBarTitleForeground', "Side bar title foreground color. The side bar is the container for views like explorer and search."));

export const SIDE_BAR_DRAG_AND_DROP_BACKGROUND = registerColor('sideBar.dropBackground', {
	dark: EDITOR_DRAG_AND_DROP_BACKGROUND,
	light: EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcDark: EDITOR_DRAG_AND_DROP_BACKGROUND,
	hcLight: EDITOR_DRAG_AND_DROP_BACKGROUND
}, localize('sideBarDragAndDropBackground', "Drag and drop feedback color for the side bar sections. The color should have transparency so that the side bar sections can still shine through. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));

export const SIDE_BAR_SECTION_HEADER_BACKGROUND = registerColor('sideBarSectionHeader.background', {
	dark: Color.fromHex('#808080').transparent(0.2),
	light: Color.fromHex('#808080').transparent(0.2),
	hcDark: null,
	hcLight: null
}, localize('sideBarSectionHeaderBackground', "Side bar section header background color. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));

export const SIDE_BAR_SECTION_HEADER_FOREGROUND = registerColor('sideBarSectionHeader.foreground', {
	dark: SIDE_BAR_FOREGROUND,
	light: SIDE_BAR_FOREGROUND,
	hcDark: SIDE_BAR_FOREGROUND,
	hcLight: SIDE_BAR_FOREGROUND
}, localize('sideBarSectionHeaderForeground', "Side bar section header foreground color. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));

export const SIDE_BAR_SECTION_HEADER_BORDER = registerColor('sideBarSectionHeader.border', {
	dark: contrastBorder,
	light: contrastBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('sideBarSectionHeaderBorder', "Side bar section header border color. The side bar is the container for views like explorer and search. Side bar sections are views nested within the side bar."));


// < --- Title Bar --- >

export const TITLE_BAR_ACTIVE_FOREGROUND = registerColor('titleBar.activeForeground', {
	dark: '#CCCCCC',
	light: '#333333',
	hcDark: '#FFFFFF',
	hcLight: '#292929'
}, localize('titleBarActiveForeground', "Title bar foreground when the window is active."));

export const TITLE_BAR_INACTIVE_FOREGROUND = registerColor('titleBar.inactiveForeground', {
	dark: transparent(TITLE_BAR_ACTIVE_FOREGROUND, 0.6),
	light: transparent(TITLE_BAR_ACTIVE_FOREGROUND, 0.6),
	hcDark: null,
	hcLight: '#292929'
}, localize('titleBarInactiveForeground', "Title bar foreground when the window is inactive."));

export const TITLE_BAR_ACTIVE_BACKGROUND = registerColor('titleBar.activeBackground', {
	dark: '#3C3C3C',
	light: '#DDDDDD',
	hcDark: '#000000',
	hcLight: '#FFFFFF'
}, localize('titleBarActiveBackground', "Title bar background when the window is active."));

export const TITLE_BAR_INACTIVE_BACKGROUND = registerColor('titleBar.inactiveBackground', {
	dark: transparent(TITLE_BAR_ACTIVE_BACKGROUND, 0.6),
	light: transparent(TITLE_BAR_ACTIVE_BACKGROUND, 0.6),
	hcDark: null,
	hcLight: null,
}, localize('titleBarInactiveBackground', "Title bar background when the window is inactive."));

export const TITLE_BAR_BORDER = registerColor('titleBar.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('titleBarBorder', "Title bar border color."));

// < --- Menubar --- >

export const MENUBAR_SELECTION_FOREGROUND = registerColor('menubar.selectionForeground', {
	dark: TITLE_BAR_ACTIVE_FOREGROUND,
	light: TITLE_BAR_ACTIVE_FOREGROUND,
	hcDark: TITLE_BAR_ACTIVE_FOREGROUND,
	hcLight: TITLE_BAR_ACTIVE_FOREGROUND,
}, localize('menubarSelectionForeground', "Foreground color of the selected menu item in the menubar."));

export const MENUBAR_SELECTION_BACKGROUND = registerColor('menubar.selectionBackground', {
	dark: toolbarHoverBackground,
	light: toolbarHoverBackground,
	hcDark: null,
	hcLight: null,
}, localize('menubarSelectionBackground', "Background color of the selected menu item in the menubar."));

export const MENUBAR_SELECTION_BORDER = registerColor('menubar.selectionBorder', {
	dark: null,
	light: null,
	hcDark: activeContrastBorder,
	hcLight: activeContrastBorder,
}, localize('menubarSelectionBorder', "Border color of the selected menu item in the menubar."));

// < --- Command Center --- >

// foreground (inactive and active)
export const COMMAND_CENTER_FOREGROUND = registerColor(
	'commandCenter.foreground',
	{ dark: TITLE_BAR_ACTIVE_FOREGROUND, hcDark: TITLE_BAR_ACTIVE_FOREGROUND, light: TITLE_BAR_ACTIVE_FOREGROUND, hcLight: TITLE_BAR_ACTIVE_FOREGROUND },
	localize('commandCenter-foreground', "Foreground color of the command center"),
	false
);
export const COMMAND_CENTER_ACTIVEFOREGROUND = registerColor(
	'commandCenter.activeForeground',
	{ dark: MENUBAR_SELECTION_FOREGROUND, hcDark: MENUBAR_SELECTION_FOREGROUND, light: MENUBAR_SELECTION_FOREGROUND, hcLight: MENUBAR_SELECTION_FOREGROUND },
	localize('commandCenter-activeForeground', "Active foreground color of the command center"),
	false
);
export const COMMAND_CENTER_INACTIVEFOREGROUND = registerColor(
	'commandCenter.inactiveForeground',
	{ dark: TITLE_BAR_INACTIVE_FOREGROUND, hcDark: TITLE_BAR_INACTIVE_FOREGROUND, light: TITLE_BAR_INACTIVE_FOREGROUND, hcLight: TITLE_BAR_INACTIVE_FOREGROUND },
	localize('commandCenter-inactiveForeground', "Foreground color of the command center when the window is inactive"),
	false
);
// background (inactive and active)
export const COMMAND_CENTER_BACKGROUND = registerColor(
	'commandCenter.background',
	{ dark: Color.white.transparent(0.05), hcDark: null, light: Color.black.transparent(0.05), hcLight: null },
	localize('commandCenter-background', "Background color of the command center"),
	false
);
export const COMMAND_CENTER_ACTIVEBACKGROUND = registerColor(
	'commandCenter.activeBackground',
	{ dark: Color.white.transparent(0.08), hcDark: MENUBAR_SELECTION_BACKGROUND, light: Color.black.transparent(0.08), hcLight: MENUBAR_SELECTION_BACKGROUND },
	localize('commandCenter-activeBackground', "Active background color of the command center"),
	false
);
// border: active and inactive. defaults to active background
export const COMMAND_CENTER_BORDER = registerColor(
	'commandCenter.border', { dark: transparent(TITLE_BAR_ACTIVE_FOREGROUND, .20), hcDark: contrastBorder, light: transparent(TITLE_BAR_ACTIVE_FOREGROUND, .20), hcLight: contrastBorder },
	localize('commandCenter-border', "Border color of the command center"),
	false
);
export const COMMAND_CENTER_ACTIVEBORDER = registerColor(
	'commandCenter.activeBorder', { dark: transparent(TITLE_BAR_ACTIVE_FOREGROUND, .30), hcDark: TITLE_BAR_ACTIVE_FOREGROUND, light: transparent(TITLE_BAR_ACTIVE_FOREGROUND, .30), hcLight: TITLE_BAR_ACTIVE_FOREGROUND },
	localize('commandCenter-activeBorder', "Active border color of the command center"),
	false
);
// border: defaults to active background
export const COMMAND_CENTER_INACTIVEBORDER = registerColor(
	'commandCenter.inactiveBorder', { dark: transparent(TITLE_BAR_INACTIVE_FOREGROUND, .25), hcDark: transparent(TITLE_BAR_INACTIVE_FOREGROUND, .25), light: transparent(TITLE_BAR_INACTIVE_FOREGROUND, .25), hcLight: transparent(TITLE_BAR_INACTIVE_FOREGROUND, .25) },
	localize('commandCenter-inactiveBorder', "Border color of the command center when the window is inactive"),
	false
);


// < --- Notifications --- >

export const NOTIFICATIONS_CENTER_BORDER = registerColor('notificationCenter.border', {
	dark: widgetBorder,
	light: widgetBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('notificationCenterBorder', "Notifications center border color. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_TOAST_BORDER = registerColor('notificationToast.border', {
	dark: widgetBorder,
	light: widgetBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('notificationToastBorder', "Notification toast border color. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_FOREGROUND = registerColor('notifications.foreground', {
	dark: editorWidgetForeground,
	light: editorWidgetForeground,
	hcDark: editorWidgetForeground,
	hcLight: editorWidgetForeground
}, localize('notificationsForeground', "Notifications foreground color. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_BACKGROUND = registerColor('notifications.background', {
	dark: editorWidgetBackground,
	light: editorWidgetBackground,
	hcDark: editorWidgetBackground,
	hcLight: editorWidgetBackground
}, localize('notificationsBackground', "Notifications background color. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_LINKS = registerColor('notificationLink.foreground', {
	dark: textLinkForeground,
	light: textLinkForeground,
	hcDark: textLinkForeground,
	hcLight: textLinkForeground
}, localize('notificationsLink', "Notification links foreground color. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_CENTER_HEADER_FOREGROUND = registerColor('notificationCenterHeader.foreground', {
	dark: null,
	light: null,
	hcDark: null,
	hcLight: null
}, localize('notificationCenterHeaderForeground', "Notifications center header foreground color. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_CENTER_HEADER_BACKGROUND = registerColor('notificationCenterHeader.background', {
	dark: lighten(NOTIFICATIONS_BACKGROUND, 0.3),
	light: darken(NOTIFICATIONS_BACKGROUND, 0.05),
	hcDark: NOTIFICATIONS_BACKGROUND,
	hcLight: NOTIFICATIONS_BACKGROUND
}, localize('notificationCenterHeaderBackground', "Notifications center header background color. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_BORDER = registerColor('notifications.border', {
	dark: NOTIFICATIONS_CENTER_HEADER_BACKGROUND,
	light: NOTIFICATIONS_CENTER_HEADER_BACKGROUND,
	hcDark: NOTIFICATIONS_CENTER_HEADER_BACKGROUND,
	hcLight: NOTIFICATIONS_CENTER_HEADER_BACKGROUND
}, localize('notificationsBorder', "Notifications border color separating from other notifications in the notifications center. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_ERROR_ICON_FOREGROUND = registerColor('notificationsErrorIcon.foreground', {
	dark: editorErrorForeground,
	light: editorErrorForeground,
	hcDark: editorErrorForeground,
	hcLight: editorErrorForeground
}, localize('notificationsErrorIconForeground', "The color used for the icon of error notifications. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_WARNING_ICON_FOREGROUND = registerColor('notificationsWarningIcon.foreground', {
	dark: editorWarningForeground,
	light: editorWarningForeground,
	hcDark: editorWarningForeground,
	hcLight: editorWarningForeground
}, localize('notificationsWarningIconForeground', "The color used for the icon of warning notifications. Notifications slide in from the bottom right of the window."));

export const NOTIFICATIONS_INFO_ICON_FOREGROUND = registerColor('notificationsInfoIcon.foreground', {
	dark: editorInfoForeground,
	light: editorInfoForeground,
	hcDark: editorInfoForeground,
	hcLight: editorInfoForeground
}, localize('notificationsInfoIconForeground', "The color used for the icon of info notifications. Notifications slide in from the bottom right of the window."));

export const WINDOW_ACTIVE_BORDER = registerColor('window.activeBorder', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('windowActiveBorder', "The color used for the border of the window when it is active. Only supported in the macOS and Linux desktop client when using the custom title bar."));

export const WINDOW_INACTIVE_BORDER = registerColor('window.inactiveBorder', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('windowInactiveBorder', "The color used for the border of the window when it is inactive. Only supported in the macOS and Linux desktop client when using the custom title bar."));

// --- Start Positron ---
// *************************************************************************************************
// *************************************************************************************************
// *************************************************************************************************
// *************************************************************************************************
// *************************************************************************************************

// < --- Positron Scroll Bar --- >

// Positron scroll bar border color.
export const POSITRON_SCROLL_BAR_BORDER = registerColor('positronScrollBar.border', {
	dark: darken(PANEL_BORDER, 0.25),
	light: lighten(PANEL_BORDER, 0.5),
	hcDark: PANEL_BORDER,
	hcLight: PANEL_BORDER
}, localize('positronScrollBar.border', "Positron scroll bar border color."));

// < --- Positron Tool Tip --- >

// Positron tool tip background color.
export const POSITRON_TOOL_TIP_BACKGROUND = registerColor('positronToolTip.background', {
	dark: '#252526',
	light: '#f3f3f3',
	hcDark: '#252526',
	hcLight: '#f3f3f3'
}, localize('positronToolTip.background', "Positron tool tip background color."));

// Positron tool tip border color.
export const POSITRON_TOOL_TIP_BORDER = registerColor('positronToolTip.border', {
	dark: '#454545',
	light: '#c8c8c8',
	hcDark: '#454545',
	hcLight: '#c8c8c8'
}, localize('positronToolTip.border', "Positron tool tip border color."));

// < --- Positron Top Action Bar --- >

// Positron top action bar logo background color.
export const POSITRON_TOP_ACTION_BAR_LOGO_BACKGROUND = registerColor('positronTopActionBar.logoBackground', {
	dark: darken(ACTIVITY_BAR_BACKGROUND, 0.15),
	light: darken(ACTIVITY_BAR_BACKGROUND, 0.15),
	hcDark: null,
	hcLight: null
}, localize('positronTopActionBar.logoBackground', "Positron top action bar logo background color."));

// Positron top action bar border color.
export const POSITRON_TOP_ACTION_BAR_BORDER = registerColor('positronTopActionBar.border', {
	dark: '#252527',
	light: '#cbd0d5',
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('positronTopActionBar.border', "Positron top action bar border color."));

// Positron top action bar background color.
export const POSITRON_TOP_ACTION_BAR_BACKGROUND = registerColor('positronTopActionBar.background', {
	dark: 'titleBar.activeBackground',
	light: 'titleBar.activeBackground',
	hcDark: 'titleBar.activeBackground',
	hcLight: 'titleBar.activeBackground'
}, localize('positronTopActionBar.background', "Positron top action bar background color."));

// Positron top action bar foreground color.
export const POSITRON_TOP_ACTION_BAR_FOREGROUND = registerColor('positronTopActionBar.foreground', {
	dark: foreground,
	light: foreground,
	hcDark: foreground,
	hcLight: foreground
}, localize('positronTopActionBar.foreground', "Positron top action bar foreground color."));

// Positron top action bar disabled foreground color.
export const POSITRON_TOP_ACTION_BAR_DISABLED_FOREGROUND = registerColor('positronTopActionBar.disabledForeground', {
	dark: disabledForeground,
	light: disabledForeground,
	hcDark: disabledForeground,
	hcLight: disabledForeground
}, localize('positronTopActionBar.disabledForeground', "Positron top action bar disabled foreground color."));

// Positron top action bar separator color.
export const POSITRON_TOP_ACTION_BAR_SEPARATOR = registerColor('positronTopActionBar.separator', {
	dark: '#434b4f',
	light: '#dfe3e6',
	hcDark: '#dfe3e6',
	hcLight: '#dfe3e6'
}, localize('positronTopActionBar.separator', "Positron top action bar separator color."));

// Positron top action bar select border color.
export const POSITRON_TOP_ACTION_BAR_SELECT_BORDER = registerColor('positronTopActionBar.selectBorder', {
	dark: selectBorder,
	light: selectBorder,
	hcDark: selectBorder,
	hcLight: selectBorder
}, localize('positronTopActionBar.selectBorder', "Positron top action bar select border color."));

// Positron top action bar select box background color.
export const POSITRON_TOP_ACTION_BAR_SELECT_BOX_BACKGROUND = registerColor('positronTopActionBar.selectBoxBackground', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('positronTopActionBar.selectBoxBackground', "Positron top action bar select box background color."));

// Positron top action bar hover background color.
export const POSITRON_TOP_ACTION_BAR_HOVER_BACKGROUND = registerColor('positronTopActionBar.hoverBackground', {
	dark: '#000000',
	light: '#dae1ea',
	hcDark: null,
	hcLight: null
}, localize('positronTopActionBar.hoverBackground', "Positron top action bar hover background color."));

// Positron top action bar text input background color.
export const POSITRON_TOP_ACTION_BAR_TEXT_INPUT_BACKGROUND = registerColor('positronTopActionBar.textInputBackground', {
	dark: '#3a3d41',
	light: '#ffffff',
	hcDark: '#3a3d41',
	hcLight: '#ffffff'
}, localize('positronTopActionBar.textInputBackground', "Positron top action bar text input background color."));

// Positron top action bar text input border color.
export const POSITRON_TOP_ACTION_BAR_TEXT_INPUT_BORDER = registerColor('positronTopActionBar.textInputBorder', {
	dark: '#3a3d41',
	light: '#5f6a79',
	hcDark: '#3a3d41',
	hcLight: '#5f6a79'
}, localize('positronTopActionBar.textInputBorder', "Positron top action bar text input border."));

// Positron top action bar text input selection foreground color.
export const POSITRON_TOP_ACTION_BAR_TEXT_INPUT_SELECTION_FOREGROUND = registerColor('positronTopActionBar.textInputSelectionForeground', {
	dark: '#ffffff',
	light: '#ffffff',
	hcDark: '#ffffff',
	hcLight: '#ffffff'
}, localize('positronTopActionBar.textInputSelectionForeground', "Positron top action bar text input selection foreground color."));

// Positron top action bar text input selection background color.
export const POSITRON_TOP_ACTION_BAR_TEXT_INPUT_SELECTION_BACKGROUND = registerColor('positronTopActionBar.textInputSelectionBackground', {
	dark: '#0e639c',
	light: '#007acc',
	hcDark: '#0e639c',
	hcLight: '#007acc'
}, localize('positronTopActionBar.textInputSelectionBackground', "Positron top action bar text input selection background color."));

// < --- Positron Runtimes Manager --- >

// Positron runtimes manager background.
export const POSITRON_RUNTIMES_MANAGER_BACKGROUND = registerColor('positronRuntimesManager.background', {
	dark: editorWidgetBackground,
	light: editorWidgetBackground,
	hcDark: editorWidgetBackground,
	hcLight: editorWidgetBackground
}, localize('positronRuntimesManager.background', "Positron runtimes manager background color."));

// Positron runtimes manager hover background.
export const POSITRON_RUNTIMES_MANAGER_HOVER_BACKGROUND = registerColor('positronRuntimesManager.hoverBackground', {
	dark: listHoverBackground,
	light: listHoverBackground,
	hcDark: listHoverBackground,
	hcLight: listHoverBackground
}, localize('positronRuntimesManager.hoverBackground', "Positron runtimes manager hover background color."));

// Positron runtimes manager hover foreground.
export const POSITRON_RUNTIMES_MANAGER_HOVER_FOREGROUND = registerColor('positronRuntimesManager.hoverForeground', {
	dark: listHoverForeground,
	light: listHoverForeground,
	hcDark: listHoverForeground,
	hcLight: listHoverForeground
}, localize('positronRuntimesManager.hoverForeground', "Positron runtimes manager hover foreground color."));

// Positron runtimes manager action hover background.
export const POSITRON_RUNTIMES_MANAGER_ACTION_HOVER_BACKGROUND = registerColor('positronRuntimesManager.actionHoverBackground', {
	dark: darken(listHoverBackground, 0.2),
	light: darken(listHoverBackground, 0.1),
	hcDark: listActiveSelectionBackground,
	hcLight: listActiveSelectionBackground
}, localize('positronRuntimesManager.actionHoverBackground', "Positron runtimes manager action hover background color."));

// < --- Positron Context Menu --- >

// Positron context menu background.
export const POSITRON_CONTEXT_MENU_BACKGROUND = registerColor('positronContextMenu.background', {
	dark: editorWidgetBackground,
	light: editorWidgetBackground,
	hcDark: editorWidgetBackground,
	hcLight: editorWidgetBackground
}, localize('positronContextMenu.background', "Positron context menu background color."));

// Positron context menu hover background.
export const POSITRON_CONTEXT_MENU_HOVER_BACKGROUND = registerColor('positronContextMenu.hoverBackground', {
	dark: listHoverBackground,
	light: listHoverBackground,
	hcDark: listHoverBackground,
	hcLight: listHoverBackground
}, localize('positronContextMenu.hoverBackground', "Positron context menu hover background color."));

// Positron context menu hover foreground.
export const POSITRON_CONTEXT_MENU_HOVER_FOREGROUND = registerColor('positronContextMenu.hoverForeground', {
	dark: listHoverForeground,
	light: listHoverForeground,
	hcDark: listHoverForeground,
	hcLight: listHoverForeground
}, localize('positronContextMenu.hoverForeground', "Positron context menu hover foreground color."));

// Positron context menu action hover background.
export const POSITRON_CONTEXT_MENU_ACTION_HOVER_BACKGROUND = registerColor('positronContextMenu.actionHoverBackground', {
	dark: darken(listHoverBackground, 0.2),
	light: darken(listHoverBackground, 0.1),
	hcDark: listActiveSelectionBackground,
	hcLight: listActiveSelectionBackground
}, localize('positronContextMenu.actionHoverBackground', "Positron context menu action hover background color."));

// < --- Positron Side Action Bar --- >

// Positron side action bar border color.
export const POSITRON_SIDE_ACTION_BAR_BORDER = registerColor('positronSideActionBar.border', {
	dark: '#434b4f',
	light: '#d9dee2',
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('positronSideActionBar.border', "Positron side action bar border color."));

// Positron side action bar background color.
export const POSITRON_SIDE_ACTION_BAR_BACKGROUND = registerColor('positronSideActionBar.background', {
	dark: 'terminal.background',
	light: 'terminal.background',
	hcDark: 'terminal.background',
	hcLight: 'terminal.background'
}, localize('positronSideActionBar.background', "Positron side action bar background color."));

// Positron side action bar foreground color.
export const POSITRON_SIDE_ACTION_BAR_FOREGROUND = registerColor('positronSideActionBar.foreground', {
	dark: foreground,
	light: '#75828D',
	hcDark: '#ffffff',
	hcLight: editorForeground
}, localize('positronSideActionBar.foreground', "Positron side action bar foreground color."));

// Positron side action bar disabled foreground color.
export const POSITRON_SIDE_ACTION_BAR_DISABLED_FOREGROUND = registerColor('positronSideActionBar.disabledForeground', {
	dark: '#5f6b74',
	light: '#b9c0c6',
	hcDark: '#6e7c88',
	hcLight: '#b9c0c6'
}, localize('positronSideActionBar.disabledForeground', "Positron side action bar disabled foreground color."));

// Positron side action bar separator color.
export const POSITRON_SIDE_ACTION_BAR_SEPARATOR = registerColor('positronSideActionBar.separator', {
	dark: '#434b4f',
	light: '#dfe3e6',
	hcDark: '#2f3436',
	hcLight: '#dfe3e6'
}, localize('positronSideActionBar.separator', "Positron side action bar separator color."));

// Positron side action bar hover background color.
export const POSITRON_SIDE_ACTION_BAR_HOVER_BACKGROUND = registerColor('positronSideActionBar.hoverBackground', {
	dark: '#292a2a',
	light: '#dae1ea',
	hcDark: null,
	hcLight: null
}, localize('positronSideActionBar.hoverBackground', "Positron side action bar hover background color."));

// Positron side action bar text input background color.
export const POSITRON_SIDE_ACTION_BAR_TEXT_INPUT_BACKGROUND = registerColor('positronSideActionBar.textInputBackground', {
	dark: '#000000',
	light: '#ffffff',
	hcDark: '#000000',
	hcLight: '#ffffff'
}, localize('positronSideActionBar.textInputBackground', "Positron side action bar text input background color."));

// Positron side action bar text input border color.
export const POSITRON_SIDE_ACTION_BAR_TEXT_INPUT_BORDER = registerColor('positronSideActionBar.textInputBorder', {
	dark: '#434b4f',
	light: '#cbd0d5',
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('positronSideActionBar.textInputBorder', "Positron side action bar text input border."));

// Positron side action bar text input selection foreground color.
export const POSITRON_SIDE_ACTION_BAR_TEXT_INPUT_SELECTION_FOREGROUND = registerColor('positronSideActionBar.textInputSelectionForeground', {
	dark: '#ffffff',
	light: '#ffffff',
	hcDark: '#ffffff',
	hcLight: '#ffffff'
}, localize('positronSideActionBar.textInputSelectionForeground', "Positron side action bar text input selection foreground color."));

// Positron side action bar text input selection background color.
export const POSITRON_SIDE_ACTION_BAR_TEXT_INPUT_SELECTION_BACKGROUND = registerColor('positronSideActionBar.textInputSelectionBackground', {
	dark: '#0e639c',
	light: '#007acc',
	hcDark: '#0e639c',
	hcLight: '#007acc'
}, localize('positronSideActionBar.textInputSelectionBackground', "Positron side action bar text input selection background color."));

// < --- Positron Modal Dialog --- >

// Positron modal dialog background color.
export const POSITRON_MODAL_DIALOG_BACKGROUND = registerColor('positronModalDialog.background', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('positronModalDialog.background', "Positron modal dialog background color."));

// Positron modal dialog foreground color.
export const POSITRON_MODAL_DIALOG_FOREGROUND = registerColor('positronModalDialog.foreground', {
	dark: foreground,
	light: '#000000',
	hcDark: foreground,
	hcLight: foreground
}, localize('positronModalDialog.foreground', "Positron modal dialog foreground color."));

// Positron modal dialog border color.
export const POSITRON_MODAL_DIALOG_BORDER = registerColor('positronModalDialog.border', {
	dark: selectBorder,
	light: selectBorder,
	hcDark: selectBorder,
	hcLight: selectBorder
}, localize('positronModalDialog.border', "Positron modal dialog border color."));

// Positron modal dialog separator color.
export const POSITRON_MODAL_DIALOG_SEPARATOR = registerColor('positronModalDialog.separator', {
	dark: '#3a3d41',
	light: darken(POSITRON_MODAL_DIALOG_BACKGROUND, 0.2),
	hcDark: '#3a3d41',
	hcLight: darken(POSITRON_MODAL_DIALOG_BACKGROUND, 0.2)
}, localize('positronModalDialog.separator', "Positron modal dialog separator color."));

// < --- Positron Modal Dialog Title Bar --- >

// Positron modal dialog title bar background color.
export const POSITRON_MODAL_DIALOG_TITLE_BAR_BACKGROUND = registerColor('positronModalDialog.titleBarBackground', {
	dark: ACTIVITY_BAR_BACKGROUND,
	light: ACTIVITY_BAR_BACKGROUND,
	hcDark: ACTIVITY_BAR_BACKGROUND,
	hcLight: ACTIVITY_BAR_BACKGROUND
}, localize('positronModalDialog.titleBarBackground', "Positron modal dialog title bar background color."));

// Positron modal dialog title bar foreground color.
export const POSITRON_MODAL_DIALOG_TITLE_BAR_FOREGROUND = registerColor('positronModalDialog.titleBarForeground', {
	dark: ACTIVITY_BAR_FOREGROUND,
	light: ACTIVITY_BAR_FOREGROUND,
	hcDark: ACTIVITY_BAR_FOREGROUND,
	hcLight: ACTIVITY_BAR_FOREGROUND
}, localize('positronModalDialog.titleBarForeground', "Positron modal dialog title bar foreground color."));

// < --- Positron Modal Dialog Button --- >

// Positron modal dialog button background color.
export const POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND = registerColor('positronModalDialog.buttonBackground', {
	dark: buttonSecondaryBackground,
	light: buttonSecondaryBackground,
	hcDark: null,
	hcLight: null
}, localize('positronModalDialog.buttonBackground', "Positron modal dialog button background color."));

// Positron modal dialog button hover background color.
export const POSITRON_MODAL_DIALOG_BUTTON_HOVER_BACKGROUND = registerColor('positronModalDialog.buttonHoverBackground', {
	dark: lighten(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15),
	light: darken(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15),
	hcDark: lighten(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15),
	hcLight: darken(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15)
}, localize('positronModalDialog.buttonHoverBackground', "Positron modal dialog button hover background color."));

// Positron modal dialog button background color.
export const POSITRON_MODAL_DIALOG_DEFAULT_BUTTON_BACKGROUND = registerColor('positronModalDialog.defaultButtonBackground', {
	dark: buttonBackground,
	light: buttonBackground,
	hcDark: buttonBackground,
	hcLight: buttonBackground
}, localize('positronModalDialog.defaultButtonBackground', "Positron modal dialog default button background color."));

// Positron modal dialog button hover background color.
export const POSITRON_MODAL_DIALOG_DEFAULT_BUTTON_HOVER_BACKGROUND = registerColor('positronModalDialog.defaultButtonHoverBackground', {
	dark: lighten(POSITRON_MODAL_DIALOG_DEFAULT_BUTTON_BACKGROUND, 0.15),
	light: darken(POSITRON_MODAL_DIALOG_DEFAULT_BUTTON_BACKGROUND, 0.15),
	hcDark: lighten(POSITRON_MODAL_DIALOG_DEFAULT_BUTTON_BACKGROUND, 0.15),
	hcLight: darken(POSITRON_MODAL_DIALOG_DEFAULT_BUTTON_BACKGROUND, 0.15)
}, localize('positronModalDialog.defaultButtonHoverBackground', "Positron modal dialog default button hover background color."));

// Positron modal dialog button active background color.
export const POSITRON_MODAL_DIALOG_BUTTON_ACTIVE_BACKGROUND = registerColor('positronModalDialog.buttonActiveBackground', {
	dark: lighten(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15),
	light: darken(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15),
	hcDark: lighten(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15),
	hcLight: darken(POSITRON_MODAL_DIALOG_BUTTON_BACKGROUND, 0.15)
}, localize('positronModalDialog.buttonActiveBackground', "Positron modal dialog button active background color."));

// Positron modal dialog button foreground color.
export const POSITRON_MODAL_DIALOG_BUTTON_FOREGROUND = registerColor('positronModalDialog.buttonForeground', {
	dark: buttonSecondaryForeground,
	light: buttonSecondaryForeground,
	hcDark: foreground,
	hcLight: foreground
}, localize('positronModalDialog.buttonForeground', "Positron modal dialog button foreground color."));

// Positron modal dialog button foreground color.
export const POSITRON_MODAL_DIALOG_DEFAULT_BUTTON_FOREGROUND = registerColor('positronModalDialog.defaultButtonForeground', {
	dark: buttonForeground,
	light: buttonForeground,
	hcDark: buttonForeground,
	hcLight: buttonForeground
}, localize('positronModalDialog.defaultButtonForeground', "Positron modal dialog default button foreground color."));

// Positron modal dialog button border color.
export const POSITRON_MODAL_DIALOG_BUTTON_BORDER = registerColor('positronModalDialog.buttonBorder', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('positronModalDialog.buttonBorder', "Positron modal dialog button border color."));

// < --- Positron Modal Dialog Text Input --- >

// Positron modal dialog text input background color.
export const POSITRON_MODAL_DIALOG_TEXT_INPUT_BACKGROUND = registerColor('positronModalDialog.textInputBackground', {
	dark: '#292f32',
	light: '#ffffff',
	hcDark: inputBackground,
	hcLight: inputBackground
}, localize('positronModalDialog.textInputBackground', "Positron modal dialog text input background color."));

// Positron modal dialog text input border color.
export const POSITRON_MODAL_DIALOG_TEXT_INPUT_BORDER = registerColor('positronModalDialog.textInputBorder', {
	dark: '#292f32',
	light: '#a6a6a6',
	hcDark: inputBorder,
	hcLight: inputBorder
}, localize('positronModalDialog.textInputBorder', "Positron modal dialog text input border."));

// Positron modal dialog text input selection foreground color.
export const POSITRON_MODAL_DIALOG_TEXT_INPUT_SELECTION_FOREGROUND = registerColor('positronModalDialog.textInputSelectionForeground', {
	dark: '#ffffff',
	light: '#ffffff',
	hcDark: '#ffffff',
	hcLight: '#ffffff'
}, localize('positronModalDialog.textInputSelectionForeground', "Positron modal dialog text input selection foreground color."));

// Positron modal dialog text input selection background color.
export const POSITRON_MODAL_DIALOG_TEXT_INPUT_SELECTION_BACKGROUND = registerColor('positronModalDialog.textInputSelectionBackground', {
	dark: '#0e639c',
	light: '#007acc',
	hcDark: '#0e639c',
	hcLight: '#007acc'
}, localize('positronModalDialog.textInputSelectionBackground', "Positron modal dialog text input selection background color."));

// < --- Positron Modal Dialog Checkbox --- >

// Positron modal dialog checkbox background color.
export const POSITRON_MODAL_DIALOG_CHECKBOX_BACKGROUND = registerColor('positronModalDialog.checkboxBackground', {
	dark: '#292f32',
	light: '#ffffff',
	hcDark: checkboxBackground,
	hcLight: checkboxBackground
}, localize('positronModalDialog.checkboxBackground', "Positron modal dialog checkbox background color."));

// Positron modal dialog checkbox foreground color.
export const POSITRON_MODAL_DIALOG_CHECKBOX_FOREGROUND = registerColor('positronModalDialog.checkboxForeground', {
	dark: foreground,
	light: '#000000',
	hcDark: checkboxForeground,
	hcLight: checkboxForeground
}, localize('positronModalDialog.checkboxForeground', "Positron modal dialog checkbox foreground."));

// Positron modal dialog checkbox border color.
export const POSITRON_MODAL_DIALOG_CHECKBOX_BORDER = registerColor('positronModalDialog.checkboxBorder', {
	dark: '#292f32',
	light: '#a6a6a6',
	hcDark: checkboxBorder,
	hcLight: checkboxBorder
}, localize('positronModalDialog.checkboxBorder', "Positron modal dialog checkbox border."));

// < --- Positron Console --- >

// Positron console background color.
export const POSITRON_CONSOLE_BACKGROUND_COLOR = registerColor('positronConsole.background', {
	dark: 'terminal.background',
	light: 'terminal.background',
	hcDark: 'terminal.background',
	hcLight: 'terminal.background'
}, localize('positronConsole.background', "Positron console background color."));

// Positron console foreground color.
export const POSITRON_CONSOLE_FOREGROUND_COLOR = registerColor('positronConsole.foreground', {
	dark: 'terminal.foreground',
	light: 'terminal.foreground',
	hcDark: 'terminal.foreground',
	hcLight: 'terminal.foreground'
}, localize('positronConsole.foreground', "Positron console foreground color."));

// Positron console error background color.
export const POSITRON_CONSOLE_ERROR_BACKGROUND_COLOR = registerColor('positronConsole.errorBackground', {
	dark: transparent('terminal.ansiRed', 0.1),
	light: transparent('terminal.ansiRed', 0.05),
	hcDark: 'terminal.background',
	hcLight: 'terminal.background'
}, localize('positronConsole.errorBackground', "Positron console error background color."));

// Positron console error foreground color.
export const POSITRON_CONSOLE_ERROR_FOREGROUND_COLOR = registerColor('positronConsole.errorForeground', {
	dark: errorForeground,
	light: errorForeground,
	hcDark: errorForeground,
	hcLight: errorForeground
}, localize('positronConsole.errorForeground', "Positron console error foreground color."));

// Positron console ANSI black color.
export const POSITRON_CONSOLE_ANSI_BLACK = registerColor('positronConsole.ansiBlack', {
	dark: 'terminal.ansiBlack',
	light: 'terminal.ansiBlack',
	hcDark: 'terminal.ansiBlack',
	hcLight: 'terminal.ansiBlack'
}, localize('positronConsole.ansiBlack', "Positron console ANSI black color."));

// Positron console ANSI red color.
export const POSITRON_CONSOLE_ANSI_RED = registerColor('positronConsole.ansiRed', {
	dark: 'terminal.ansiRed',
	light: 'terminal.ansiRed',
	hcDark: 'terminal.ansiRed',
	hcLight: 'terminal.ansiRed'
}, localize('positronConsole.ansiRed', "Positron console ANSI red color."));

// Positron console ANSI green color.
export const POSITRON_CONSOLE_ANSI_GREEN = registerColor('positronConsole.ansiGreen', {
	dark: 'terminal.ansiGreen',
	light: 'terminal.ansiGreen',
	hcDark: 'terminal.ansiGreen',
	hcLight: 'terminal.ansiGreen'
}, localize('positronConsole.ansiGreen', "Positron console ANSI green color."));

// Positron console ANSI yellow color.
export const POSITRON_CONSOLE_ANSI_YELLOW = registerColor('positronConsole.ansiYellow', {
	dark: 'terminal.ansiYellow',
	light: 'terminal.ansiYellow',
	hcDark: 'terminal.ansiYellow',
	hcLight: 'terminal.ansiYellow'
}, localize('positronConsole.ansiYellow', "Positron console ANSI yellow color."));

// Positron console ANSI blue color.
export const POSITRON_CONSOLE_ANSI_BLUE = registerColor('positronConsole.ansiBlue', {
	dark: 'terminal.ansiBlue',
	light: 'terminal.ansiBlue',
	hcDark: 'terminal.ansiBlue',
	hcLight: 'terminal.ansiBlue'
}, localize('positronConsole.ansiBlue', "Positron console ANSI blue color."));

// Positron console ANSI magenta color.
export const POSITRON_CONSOLE_ANSI_MAGENTA = registerColor('positronConsole.ansiMagenta', {
	dark: 'terminal.ansiMagenta',
	light: 'terminal.ansiMagenta',
	hcDark: 'terminal.ansiMagenta',
	hcLight: 'terminal.ansiMagenta'
}, localize('positronConsole.ansiMagenta', "Positron console ANSI magenta color."));

// Positron console ANSI cyan color.
export const POSITRON_CONSOLE_ANSI_CYAN = registerColor('positronConsole.ansiCyan', {
	dark: 'terminal.ansiCyan',
	light: 'terminal.ansiCyan',
	hcDark: 'terminal.ansiCyan',
	hcLight: 'terminal.ansiCyan'
}, localize('positronConsole.ansiCyan', "Positron console ANSI cyan color."));

// Positron console ANSI white color.
export const POSITRON_CONSOLE_ANSI_WHITE = registerColor('positronConsole.ansiWhite', {
	dark: 'terminal.ansiWhite',
	light: 'terminal.ansiWhite',
	hcDark: 'terminal.ansiWhite',
	hcLight: 'terminal.ansiWhite'
}, localize('positronConsole.ansiWhite', "Positron console ANSI white color."));

// Positron console ANSI bright black color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_BLACK = registerColor('positronConsole.ansiBrightBlack', {
	dark: 'terminal.ansiBrightBlack',
	light: 'terminal.ansiBrightBlack',
	hcDark: 'terminal.ansiBrightBlack',
	hcLight: 'terminal.ansiBrightBlack'
}, localize('positronConsole.ansiBrightBlack', "Positron console ANSI bright black color."));

// Positron console ANSI bright red color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_RED = registerColor('positronConsole.ansiBrightRed', {
	dark: 'terminal.ansiBrightRed',
	light: 'terminal.ansiBrightRed',
	hcDark: 'terminal.ansiBrightRed',
	hcLight: 'terminal.ansiBrightRed'
}, localize('positronConsole.ansiBrightRed', "Positron console ANSI bright red color."));

// Positron console ANSI bright green color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_GREEN = registerColor('positronConsole.ansiBrightGreen', {
	dark: 'terminal.ansiBrightGreen',
	light: 'terminal.ansiBrightGreen',
	hcDark: 'terminal.ansiBrightGreen',
	hcLight: 'terminal.ansiBrightGreen'
}, localize('positronConsole.ansiBrightGreen', "Positron console ANSI bright green color."));

// Positron console ANSI bright yellow color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_YELLOW = registerColor('positronConsole.ansiBrightYellow', {
	dark: 'terminal.ansiBrightYellow',
	light: 'terminal.ansiBrightYellow',
	hcDark: 'terminal.ansiBrightYellow',
	hcLight: 'terminal.ansiBrightYellow'
}, localize('positronConsole.ansiBrightYellow', "Positron console ANSI bright yellow color."));

// Positron console ANSI bright blue color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_BLUE = registerColor('positronConsole.ansiBrightBlue', {
	dark: 'terminal.ansiBrightBlue',
	light: 'terminal.ansiBrightBlue',
	hcDark: 'terminal.ansiBrightBlue',
	hcLight: 'terminal.ansiBrightBlue'
}, localize('positronConsole.ansiBrightBlue', "Positron console ANSI bright blue color."));

// Positron console ANSI bright magenta color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_MAGENTA = registerColor('positronConsole.ansiBrightMagenta', {
	dark: 'terminal.ansiBrightMagenta',
	light: 'terminal.ansiBrightMagenta',
	hcDark: 'terminal.ansiBrightMagenta',
	hcLight: 'terminal.ansiBrightMagenta'
}, localize('positronConsole.ansiBrightMagenta', "Positron console ANSI bright magenta color."));

// Positron console ANSI bright cyan color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_CYAN = registerColor('positronConsole.ansiBrightCyan', {
	dark: 'terminal.ansiBrightCyan',
	light: 'terminal.ansiBrightCyan',
	hcDark: 'terminal.ansiBrightCyan',
	hcLight: 'terminal.ansiBrightCyan'
}, localize('positronConsole.ansiBrightCyan', "Positron console ANSI bright cyan color."));

// Positron console ANSI bright white color.
export const POSITRON_CONSOLE_ANSI_BRIGHT_WHITE = registerColor('positronConsole.ansiBrightWhite', {
	dark: 'terminal.ansiBrightWhite',
	light: 'terminal.ansiBrightWhite',
	hcDark: 'terminal.ansiBrightWhite',
	hcLight: 'terminal.ansiBrightWhite'
}, localize('positronConsole.ansiBrightWhite', "Positron console ANSI bright white color."));

// Positron console trace background color.
export const POSITRON_CONSOLE_TRACE_BACKGROUND_COLOR = registerColor('positronConsole.traceBackground', {
	dark: '#262626',
	light: '#e5e5e5',
	hcDark: '#262626',
	hcLight: '#e5e5e5'
}, localize('positronConsole.traceBackground', "Positron console trace background color."));

//  < --- Positron Data Grid --- >

// Positron data grid background color.
export const POSITRON_DATA_GRID_BACKGROUND_COLOR = registerColor('positronDataGrid.background', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('positronDataGrid.background', "Positron data grid background color."));

// Positron data grid contrast background color.
export const POSITRON_DATA_GRID_CONTRAST_BACKGROUND_COLOR = registerColor('positronDataGrid.contrastBackground', {
	dark: lighten(editorBackground, 0.2),
	light: darken(editorBackground, 0.02),
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('positronDataGrid.contrastBackground', "Positron data grid contrast background color."));

// Positron data grid foreground color.
export const POSITRON_DATA_GRID_FOREGROUND_COLOR = registerColor('positronDataGrid.foreground', {
	dark: editorForeground,
	light: editorForeground,
	hcDark: editorForeground,
	hcLight: editorForeground
}, localize('positronDataGrid.foreground', "Positron data grid foreground color."));

// Positron data grid border color.
export const POSITRON_DATA_GRID_BORDER_COLOR = registerColor('positronDataGrid.border', {
	dark: tableColumnsBorder,
	light: tableColumnsBorder,
	hcDark: tableColumnsBorder,
	hcLight: tableColumnsBorder
}, localize('positronDataGrid.border', "Positron data grid border color."));

// Positron data grid cursor border color.
export const POSITRON_DATA_GRID_CURSOR_BORDER_COLOR = registerColor('positronDataGrid.cursorBorder', {
	dark: '#0068c4',
	light: '#4891d7',
	hcDark: '#ff0000',
	hcLight: '#ff0000'
}, localize('positronDataGrid.cursorBorder', "Positron data grid cursor border color."));

// Positron data grid selection border color.
export const POSITRON_DATA_GRID_SELECTION_BORDER_COLOR = registerColor('positronDataGrid.selectionBorder', {
	dark: '#175ab5',
	light: '#70a6e0',
	hcDark: '#ff0000',
	hcLight: '#ff0000'
}, localize('positronDataGrid.selectionBorder', "Positron data grid selection border color."));

// Positron data grid selection inner border color.
export const POSITRON_DATA_GRID_SELECTION_INNER_BORDER_COLOR = registerColor('positronDataGrid.selectionInnerBorder', {
	dark: '#214984',
	light: '#a1c5ef',
	hcDark: '#ff0000',
	hcLight: '#ff0000'
}, localize('positronDataGrid.selectionInnerBorder', "Positron data grid selection border color."));

// Positron data grid selection background color.
export const POSITRON_DATA_GRID_SELECTION_BACKGROUND_COLOR = registerColor('positronDataGrid.selectionBackground', {
	dark: transparent('#1c7dfa', 0.3),
	light: transparent('#accdf3', 0.5),
	hcDark: '#ff00007f',
	hcLight: '#ff00007f'
}, localize('positronDataGrid.selectionBackground', "Positron data grid selection background color."));

// Positron data grid sort index foreground color.
export const POSITRON_DATA_GRID_SORT_INDEX_FOREGROUND_COLOR = registerColor('positronDataGrid.sortIndexForeground', {
	dark: textLinkForeground,
	light: textLinkForeground,
	hcDark: textLinkForeground,
	hcLight: textLinkForeground
}, localize('positronDataGrid.sortIndexForeground', "Positron data grid sort index foreground color."));

// < --- Positron Data Explorer --- >

// Positron data explorer background color.
export const POSITRON_DATA_TOOL_BACKGROUND_COLOR = registerColor('positronDataExplorer.background', {
	dark: editorBackground,
	light: editorBackground,
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('positronDataExplorer.background', "Positron data explorer background color."));

// Positron data explorer foreground color.
export const POSITRON_DATA_TOOL_FOREGROUND_COLOR = registerColor('positronDataExplorer.foreground', {
	dark: editorForeground,
	light: editorForeground,
	hcDark: editorForeground,
	hcLight: editorForeground
}, localize('positronDataExplorer.foreground', "Positron data explorer foreground color."));

// Positron data explorer border color.
export const POSITRON_DATA_TOOL_BORDER_COLOR = registerColor('positronDataExplorer.border', {
	dark: tableColumnsBorder,
	light: tableColumnsBorder,
	hcDark: tableColumnsBorder,
	hcLight: tableColumnsBorder
}, localize('positronDataExplorer.border', "Positron data explorer border color."));

// < --- Positron Variables --- >

// Positron variables background color.
export const POSITRON_VARIABLES_BACKGROUND_COLOR = registerColor('positronVariables.background', {
	dark: 'terminal.background',
	light: 'terminal.background',
	hcDark: 'terminal.background',
	hcLight: 'terminal.background'
}, localize('positronVariables.background', "Positron variables background color."));

// Positron variables foreground color.
export const POSITRON_VARIABLES_FOREGROUND_COLOR = registerColor('positronVariables.foreground', {
	dark: editorForeground,
	light: editorForeground,
	hcDark: editorForeground,
	hcLight: editorForeground
}, localize('positronVariables.foreground', "Positron variables foreground color."));

// Positron variables border color.
export const POSITRON_VARIABLES_BORDER_COLOR = registerColor('positronVariables.border', {
	dark: tableColumnsBorder,
	light: tableColumnsBorder,
	hcDark: tableColumnsBorder,
	hcLight: tableColumnsBorder
}, localize('positronVariables.border', "Positron variables border color."));

// Positron variables header background color.
export const POSITRON_VARIABLES_HEADER_BACKGROUND_COLOR = registerColor('positronVariables.headerBackground', {
	dark: lighten(editorBackground, 0.2),
	light: darken(editorBackground, 0.05),
	hcDark: editorBackground,
	hcLight: editorBackground
}, localize('positronVariables.headerBackground', "Positron variables header background color."));

// Positron variables row hover background color.
export const POSITRON_VARIABLES_ROW_HOVER_BACKGROUND_COLOR = registerColor('positronVariables.rowHoverBackground', {
	dark: lighten(listHoverBackground, 0.05),
	light: darken(listHoverBackground, 0.05),
	hcDark: listHoverBackground,
	hcLight: listHoverBackground
}, localize('positronVariables.rowHoverBackground', "Positron variables row hover background color."));

// Positron variables row hover foreground color.
export const POSITRON_VARIABLES_ROW_HOVER_FOREGROUND_COLOR = registerColor('positronVariables.rowHoverForeground', {
	dark: listHoverForeground,
	light: listHoverForeground,
	hcDark: listHoverForeground,
	hcLight: listHoverForeground
}, localize('positronVariables.rowHoverForeground', "Positron variables row hover foreground color."));

// Positron variables active selection background color.
export const POSITRON_VARIABLES_ACTIVE_SELECTION_BACKGROUND_COLOR = registerColor('positronVariables.activeSelectionBackground', {
	dark: listActiveSelectionBackground,
	light: listActiveSelectionBackground,
	hcDark: listActiveSelectionBackground,
	hcLight: listActiveSelectionBackground
}, localize('positronVariables.activeSelectionBackground', "Positron variables active selection background color."));

// Positron variables active selection foreground color.
export const POSITRON_VARIABLES_ACTIVE_SELECTION_FOREGROUND_COLOR = registerColor('positronVariables.activeSelectionForeground', {
	dark: listActiveSelectionForeground,
	light: listActiveSelectionForeground,
	hcDark: listActiveSelectionForeground,
	hcLight: listActiveSelectionForeground
}, localize('positronVariables.activeSelectionForeground', "Positron variables active selection foreground color."));

// Positron variables inactive selection background color.
export const POSITRON_VARIABLES_INACTIVE_SELECTION_BACKGROUND_COLOR = registerColor('positronVariables.inactiveSelectionBackground', {
	dark: listInactiveSelectionBackground,
	light: listInactiveSelectionBackground,
	hcDark: listInactiveSelectionBackground,
	hcLight: listInactiveSelectionBackground
}, localize('positronVariables.inactiveSelectionBackground', "Positron variables inactive selection background color."));

// Positron variables inactive selection foreground color.
export const POSITRON_VARIABLES_INACTIVE_SELECTION_FOREGROUND_COLOR = registerColor('positronVariables.inactiveSelectionForeground', {
	dark: listInactiveSelectionForeground,
	light: listInactiveSelectionForeground,
	hcDark: listInactiveSelectionForeground,
	hcLight: listInactiveSelectionForeground
}, localize('positronVariables.inactiveSelectionForeground', "Positron variables inactive selection foreground color."));

// < --- Positron Plots --- >

// Positron plots background color.
export const POSITRON_PLOTS_BACKGROUND_COLOR = registerColor('positronPlots.background', {
	dark: 'terminal.background',
	light: 'terminal.background',
	hcDark: 'terminal.background',
	hcLight: 'terminal.background'
}, localize('positronPlots.background', "Positron plots background color."));

// *************************************************************************************************
// *************************************************************************************************
// *************************************************************************************************
// *************************************************************************************************
// *************************************************************************************************
// --- End Positron ---
