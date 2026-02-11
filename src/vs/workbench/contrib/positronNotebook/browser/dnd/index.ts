/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export { DndContext, useDndContext } from './DndContext.js';
export { useDraggable } from './useDraggable.js';
export { useDroppable } from './useDroppable.js';
export { DragOverlay } from './DragOverlay.js';
export { closestCenter } from './collisionDetection.js';
export { SortableContext } from './SortableContext.js';
export { useSortable } from './useSortable.js';
export { AutoScrollController, calculateScrollDelta } from './autoScroll.js';
export { sortableKeyboardCoordinates } from './keyboardCoordinates.js';
export { AnimationProvider, useAnimationContext } from './AnimationContext.js';
export { Announcer, getAnnouncement } from './Announcer.js';
export { calculateSortingTransforms, transformToString, getTransition } from './animations.js';

// Plan 04: Advanced features
export { useTouchSensor } from './TouchSensor.js';
export type { TouchSensorConfig } from './TouchSensor.js';
export { animateDrop, getDefaultDropAnimationConfig } from './dropAnimation.js';
export type { DropAnimationConfig } from './dropAnimation.js';
export {
	restrictToVerticalAxis,
	restrictToHorizontalAxis,
	snapToGrid,
	restrictToParent,
	composeModifiers,
} from './modifiers.js';
export type { Modifier } from './modifiers.js';
export {
	MultiDragProvider,
	useMultiDragContext,
	useMultiDragState,
	calculateMultiDragReorder,
} from './MultiDragContext.js';
export type { MultiDragState } from './MultiDragContext.js';

export type {
	DragState,
	DragStartEvent,
	DragEndEvent,
	DragCancelEvent,
	DroppableEntry,
	KeyboardCoordinateGetter,
	AutoScrollOptions,
	SensorOptions,
	ItemTransform,
	AnimationConfig,
	SortingState,
} from './types.js';
