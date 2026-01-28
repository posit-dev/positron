/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ItemTransform, AnimationConfig } from './types.js';
import { calculateSortingTransforms, getTransition } from './animations.js';

interface AnimationContextValue {
	getTransform: (id: string) => ItemTransform | null;
	getTransitionStyle: () => string | undefined;
	updateSortingState: (
		items: string[],
		rects: Map<string, DOMRect>,
		activeId: string | null,
		overId: string | null
	) => void;
	clearAnimations: () => void;
}

const AnimationReactContext = React.createContext<AnimationContextValue | null>(null);

interface AnimationProviderProps {
	children: React.ReactNode;
	config?: AnimationConfig;
}

export function AnimationProvider({ children, config = {} }: AnimationProviderProps) {
	const { duration = 200, easing = 'ease' } = config;
	const [transforms, setTransforms] = React.useState<Map<string, ItemTransform>>(new Map());
	const [isAnimating, setIsAnimating] = React.useState(false);

	const getTransform = React.useCallback((id: string): ItemTransform | null => {
		return transforms.get(id) ?? null;
	}, [transforms]);

	const getTransitionStyle = React.useCallback((): string | undefined => {
		return isAnimating ? getTransition(duration, easing) : undefined;
	}, [isAnimating, duration, easing]);

	const updateSortingState = React.useCallback((
		items: string[],
		rects: Map<string, DOMRect>,
		activeId: string | null,
		overId: string | null
	) => {
		const newTransforms = calculateSortingTransforms(items, rects, activeId, overId);
		setTransforms(newTransforms);
		setIsAnimating(newTransforms.size > 0);
	}, []);

	const clearAnimations = React.useCallback(() => {
		setTransforms(new Map());
		setIsAnimating(false);
	}, []);

	const value = React.useMemo(() => ({
		getTransform,
		getTransitionStyle,
		updateSortingState,
		clearAnimations,
	}), [getTransform, getTransitionStyle, updateSortingState, clearAnimations]);

	return (
		<AnimationReactContext.Provider value={value}>
			{children}
		</AnimationReactContext.Provider>
	);
}

export function useAnimationContext() {
	const context = React.useContext(AnimationReactContext);
	if (!context) {
		throw new Error('useAnimationContext must be used within an AnimationProvider');
	}
	return context;
}
