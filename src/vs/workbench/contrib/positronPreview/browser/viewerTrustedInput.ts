/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewerActOutcome, IViewerDragPoint, IViewerLocation, IViewerTarget, ViewerAction } from '../common/positronViewerAgent.js';
import { IPreviewSurface, VIEWER_CONTENT_CHANGED_MESSAGE, ViewerInputStep } from './previewSurface.js';

/** How many moves a drag takes between its ends. */
const DRAG_STEPS = 10;

const hasTarget = (target: IViewerTarget): boolean => target.ref !== undefined || target.selector !== undefined;

/** The point a drag goes to on an element: its center, or an offset from its top left. */
function pointOn(location: IViewerLocation, point: IViewerDragPoint): { x: number; y: number } {
	if (point.dx === undefined && point.dy === undefined) {
		return { x: location.x + location.width / 2, y: location.y + location.height / 2 };
	}
	return { x: location.x + (point.dx ?? 0), y: location.y + (point.dy ?? 0) };
}

const center = (location: IViewerLocation) => pointOn(location, {});

/**
 * Takes an action with input sent from outside the page, as the browser
 * would get it from a user, when the surface can send it. The page gets
 * trusted events, and the browser does what they normally do: Tab moves
 * focus, shortcuts copy and paste, and a drag can start native drag and drop.
 *
 * @returns Undefined when the action has to be taken by the bridge instead:
 *   the surface can't send input, the action isn't one input helps, or the
 *   element is covered and a pointer couldn't reach it.
 */
export async function actWithTrustedInput(surface: IPreviewSurface, action: ViewerAction): Promise<IViewerActOutcome | undefined> {
	if (!surface.dispatchInput) {
		return undefined;
	}
	const send = (steps: ViewerInputStep[]) => surface.dispatchInput!(steps);
	const locate = (target: IViewerTarget, focus = false) => surface.runBridge('locate', target, { usable: true, scrollIntoView: true, focus });
	let done: string;
	let check: (() => Promise<string>) | undefined;
	switch (action.kind) {
		case 'click': {
			const location = await locate(action);
			if (!location.pointable) {
				return undefined;
			}
			const button = action.button ?? 'left';
			const { x, y } = center(location);
			const steps: ViewerInputStep[] = [{ type: 'mouse', action: 'move', x, y }];
			for (let clickCount = 1; clickCount <= (action.dblClick ? 2 : 1); clickCount++) {
				steps.push({ type: 'mouse', action: 'down', x, y, button, clickCount }, { type: 'mouse', action: 'up', x, y, button, clickCount });
			}
			await send(steps);
			const clicked = `${button === 'left' ? '' : `${button}-`}clicked`;
			const how = action.dblClick ? `Double-${clicked}` : clicked[0].toUpperCase() + clicked.slice(1);
			done = `${how} the ${location.description}.`;
			if (location.checked !== undefined && !action.dblClick && button === 'left') {
				check = async () => {
					const after = await surface.runBridge('locate', action);
					return `${how} the ${location.description}; it's now ${after.checked ? 'checked' : 'unchecked'}.`;
				};
			}
			break;
		}
		case 'hover': {
			const location = await locate(action);
			if (!location.pointable) {
				return undefined;
			}
			await send([{ type: 'mouse', action: 'move', ...center(location) }]);
			done = `Hovered over the ${location.description}.`;
			break;
		}
		case 'drag': {
			const from = await locate(action.from);
			// The bridge sends HTML drag and drop events itself, rather than
			// starting the operating system's drag.
			if (!from.pointable || from.draggable) {
				return undefined;
			}
			const to = hasTarget(action.to) ? await surface.runBridge('locate', action.to) : from;
			const start = pointOn(from, action.from);
			const end = pointOn(to, action.to);
			const steps: ViewerInputStep[] = [
				{ type: 'mouse', action: 'move', ...start },
				{ type: 'mouse', action: 'down', ...start, button: 'left', clickCount: 1 },
			];
			for (let i = 1; i <= DRAG_STEPS; i++) {
				steps.push({ type: 'mouse', action: 'move', x: start.x + (end.x - start.x) * i / DRAG_STEPS, y: start.y + (end.y - start.y) * i / DRAG_STEPS });
			}
			steps.push({ type: 'mouse', action: 'up', ...end, button: 'left', clickCount: 1 });
			await send(steps);
			done = `Dragged the ${from.description} ${to === from ? 'within it' : `to the ${to.description}`}.`;
			break;
		}
		case 'press':
		case 'type': {
			const location = hasTarget(action) ? await locate(action, true) : undefined;
			const where = location ? ` in the ${location.description}` : '';
			if (action.kind === 'press') {
				await send([{ type: 'key', key: action.key }]);
				done = `Pressed ${action.key}${where}.`;
			} else {
				await send([{ type: 'text', text: action.text }, ...(action.submit ? [{ type: 'key', key: 'Enter' } as const] : [])]);
				done = `Typed ${JSON.stringify(action.text)}${location ? ` into the ${location.description}` : ''}${action.submit ? ', then pressed Enter' : ''}.`;
			}
			break;
		}
		default:
			return undefined;
	}
	let navigated = false;
	let timedOut = false;
	try {
		timedOut = (await surface.runBridge('waitForIdle')).timedOut;
		done = await check?.() ?? done;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		// The input took the page to another address, so there's no page to wait on.
		if (reason === VIEWER_CONTENT_CHANGED_MESSAGE) {
			navigated = true;
		} else {
			done = `${done} Couldn't wait for the app to settle after it: ${reason}`;
		}
	}
	return { message: navigated ? `${done} The page went to another address.` : done, navigated, timedOut };
}
