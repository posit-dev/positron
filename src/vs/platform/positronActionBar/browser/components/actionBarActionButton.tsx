/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBarActionButton';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { OS } from 'vs/base/common/platform';
import { IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { UILabelProvider } from 'vs/base/common/keybindingLabels';
import { MenuItemAction } from 'vs/platform/actions/common/actions';
import { IModifierKeyStatus, ModifierKeyEmitter } from 'vs/base/browser/dom';
import { useRegisterWithActionBar } from 'vs/platform/positronActionBar/browser/useRegisterWithActionBar';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ActionBarButton, ActionBarButtonProps } from 'vs/platform/positronActionBar/browser/components/actionBarButton';

/**
 * Constants.
 */
const CODICON_ID = /^codicon codicon-(.+)$/;

/**
 * Determines whether alternative actions should be used.
 * @param modifierKeyStatus The modifier key status.
 * @returns A value which indicates whether alternative actions should be used.
 */
const shouldUseAlternativeActions = (modifierKeyStatus?: IModifierKeyStatus) => {
	// If the modifier key status was not supplied, get it from the modifier key emitter.
	if (!modifierKeyStatus) {
		modifierKeyStatus = ModifierKeyEmitter.getInstance().keyStatus;
	}

	// Return true if the alt key or shift key is pressed.
	return modifierKeyStatus.altKey || modifierKeyStatus.shiftKey;
};

/**
 * ActionBarActionButtonProps interface.
 */
interface ActionBarActionButtonProps {
	readonly action: IAction;
}

/**
 * ActionBarCommandButton component.
 * @param props An ActionBarCommandButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarActionButton = (props: ActionBarActionButtonProps) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [mouseInside, setMouseInside] = useState(false);
	const [useAlternativeActions, setUseAlternativeActions] = useState(
		shouldUseAlternativeActions()
	);

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Get the modifier key emitter.
		const modifierKeyEmitter = ModifierKeyEmitter.getInstance();
		disposableStore.add(modifierKeyEmitter.event(modifierKeyStatus => {
			setUseAlternativeActions(shouldUseAlternativeActions(modifierKeyStatus));
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [context.hoverManager]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Log.
	console.log(`Rendering ActionBarActionButton useAlternativeActions is ${context.useAlternativeActions}`);

	/**
	 * Returns the action tooltip.
	 * @param action The action.
	 * @returns The action tooltip.
	 */
	const actionTooltip = (action: IAction) => {
		// Get the keybinding and keybinding label.
		const keybinding = context.keybindingService.lookupKeybinding(
			action.id,
			context.contextKeyService
		);
		const keybindingLabel = keybinding && keybinding.getLabel();

		// Get the tooltip and format the result.
		const tooltip = action.tooltip || action.label;
		let formattedTooltip = keybindingLabel ?
			localize('titleAndKb', "{0} ({1})", tooltip, keybindingLabel) :
			tooltip;

		if (action instanceof MenuItemAction && action.alt && action.alt.enabled && !context.useAlternativeActions) {
			// Get the alt keybinding and alt keybinding label.
			const altKeybinding = context.keybindingService.lookupKeybinding(
				action.alt.id,
				context.contextKeyService
			);
			const altKeybindingLabel = altKeybinding && altKeybinding.getLabel();

			// Get the tooltip and format the result.
			const altTooltip = action.alt.tooltip || action.alt.label;
			formattedTooltip = localize(
				'titleAndKbAndAlt', "{0}\n[{1}] {2}",
				formattedTooltip,
				UILabelProvider.modifierLabels[OS].altKey,
				altKeybindingLabel
					? localize('titleAndKb', "{0} ({1})", altTooltip, altKeybindingLabel)
					: altTooltip
			);
		}

		// Return the formatted tooltip.
		return formattedTooltip;
	};

	// Build the dynamic properties.
	const dynamicProps = ((): ActionBarButtonProps => {
		// Get the action.
		const action = props.action instanceof MenuItemAction &&
			props.action.alt &&
			props.action.alt.enabled &&
			(context.useAlternativeActions || (mouseInside && useAlternativeActions)) ?
			props.action.alt :
			props.action;

		// Extract the icon ID from the action's class.
		const iconIdResult = action.class?.match(CODICON_ID);
		const iconId = iconIdResult?.length === 2 ? iconIdResult[1] : undefined;

		console.log(`Rendering ActionBarActionButton tooltip is ${actionTooltip(action)}`);

		// Return the properties.
		return {
			ariaLabel: action.label,
			iconId: iconId,
			tooltip: actionTooltip(action),
			disabled: !action.enabled,
			onMouseEnter: () => setMouseInside(true),
			onMouseLeave: () => setMouseInside(false),
			onPressed: () => action.run()
		};
	})();

	// Render.
	return (
		<ActionBarButton
			ref={buttonRef}
			{...dynamicProps}
		/>
	);
};
