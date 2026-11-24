/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomPositronLayoutDescription, KnownPositronLayoutParts } from '../../common/positronCustomViews.js';
import { findMatchingLayout, LayoutState } from '../../browser/layouts/layoutMatch.js';

const SIDEBAR: KnownPositronLayoutParts = 'workbench.parts.sidebar';
const PANEL: KnownPositronLayoutParts = 'workbench.parts.panel';
const AUX: KnownPositronLayoutParts = 'workbench.parts.auxiliarybar';

/** Console under the editor, variables on the right. */
const stacked: CustomPositronLayoutDescription = {
	[SIDEBAR]: { hidden: false },
	[PANEL]: { hidden: false, viewContainers: [{ id: 'console' }] },
	[AUX]: { hidden: false, viewContainers: [{ id: 'session', views: [{ id: 'variables' }] }] },
};

/** Console and variables stacked on the right, no panel. */
const sideBySide: CustomPositronLayoutDescription = {
	[SIDEBAR]: { hidden: true },
	[PANEL]: { hidden: true },
	[AUX]: { hidden: false, viewContainers: [{ id: 'session', views: [{ id: 'consoleView' }, { id: 'variables' }] }] },
};

/** Same shape as sideBySide, registered under another id. */
const sideBySideCopy = sideBySide;

const layouts = [
	{ id: 'stacked', layoutDescriptor: stacked },
	{ id: 'sideBySide', layoutDescriptor: sideBySide },
	{ id: 'sideBySideCopy', layoutDescriptor: sideBySideCopy },
];

/**
 * Builds a window state from where things are.
 * @param visible The parts on screen.
 * @param containers The part each view container is in.
 * @param views The container each view is in.
 */
function windowState(
	visible: KnownPositronLayoutParts[],
	containers: Record<string, KnownPositronLayoutParts>,
	views: Record<string, string>,
): LayoutState {
	return {
		isPartVisible: part => visible.includes(part),
		partOfContainer: id => containers[id],
		containerOfView: id => views[id],
		containerHasViews: id => Object.values(views).includes(id),
	};
}

const stackedWindow = windowState([SIDEBAR, PANEL, AUX], { console: PANEL, session: AUX }, { consoleView: 'console', variables: 'session' });
const sideBySideWindow = windowState([AUX], { console: AUX, session: AUX }, { consoleView: 'session', variables: 'session' });

describe('findMatchingLayout', () => {
	it('finds the layout whose shape the window has', () => {
		expect(findMatchingLayout(layouts, stackedWindow, undefined)).toBe('stacked');
	});

	it('finds a layout the user arranged by hand, with no layout applied before', () => {
		expect(findMatchingLayout(layouts, sideBySideWindow, undefined)).toBe('sideBySide');
	});

	it('keeps the current layout when two layouts have the same shape', () => {
		expect(findMatchingLayout(layouts, sideBySideWindow, 'sideBySideCopy')).toBe('sideBySideCopy');
	});

	it('forgets the layout when a view moves out of place', () => {
		const moved = windowState([SIDEBAR, PANEL, AUX], { console: PANEL, session: AUX }, { consoleView: 'console', variables: 'console' });
		expect(findMatchingLayout(layouts, moved, 'stacked')).toBeUndefined();
	});

	it('forgets the layout when a part the layout shows is hidden', () => {
		const panelHidden = windowState([SIDEBAR, AUX], { console: PANEL, session: AUX }, { consoleView: 'console', variables: 'session' });
		expect(findMatchingLayout(layouts, panelHidden, 'stacked')).toBeUndefined();
	});

	it('does not match a container the layout names when its views moved out', () => {
		// The console's container is still in the panel, but its view is in the session.
		const consoleMoved = windowState([SIDEBAR, PANEL, AUX], { console: PANEL, session: AUX }, { consoleView: 'session', variables: 'session' });
		expect(findMatchingLayout(layouts, consoleMoved, undefined)).toBeUndefined();
	});

	it('matches a side bar that hides itself in a narrow window either way', () => {
		const notebook: CustomPositronLayoutDescription = {
			[SIDEBAR]: { hidden: false, hideIfBelowMinSize: true },
			[AUX]: { hidden: false, viewContainers: [{ id: 'session', views: [{ id: 'variables' }] }] },
		};
		const narrowWindow = windowState([AUX], { session: AUX }, { variables: 'session' });
		expect(findMatchingLayout([{ id: 'notebook', layoutDescriptor: notebook }], narrowWindow, undefined)).toBe('notebook');
	});
});
