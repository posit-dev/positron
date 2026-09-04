/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronActionBarControlsGallery.css';

// React.
import { PropsWithChildren, useRef, useState } from 'react';

// Other dependencies.
import { controlGalleryRegistry } from '../controlGalleryRegistry.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { useRegisterWithActionBar } from '../../../../../platform/positronActionBar/browser/useRegisterWithActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ActionBarToggle } from '../../../../../platform/positronActionBar/browser/components/actionBarToggle.js';
import { ActionBarCheckbox } from '../../../../../platform/positronActionBar/browser/components/actionBarCheckbox.js';

/**
 * TextKnob component. A labelled text field.
 */
const TextKnob = (props: {
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
}) => (
	<label className='action-bar-controls-harness-knob'>
		<span>{props.label}</span>
		<input
			type='text'
			value={props.value}
			onChange={e => props.onChange(e.target.value)}
		/>
	</label>
);

/**
 * CheckKnob component. A labelled checkbox.
 */
const CheckKnob = (props: {
	readonly label: string;
	readonly value: boolean;
	readonly onChange: (value: boolean) => void;
}) => (
	<label className='action-bar-controls-harness-knob action-bar-controls-harness-checkbox'>
		<input
			checked={props.value}
			type='checkbox'
			onChange={e => props.onChange(e.target.checked)}
		/>
		<span>{props.label}</span>
	</label>
);

/**
 * PreviewBar component. A real action bar wrapped around a single control, so the control gets
 * the roving tabindex and the hover manager it would have in the workbench. Each control gets its
 * own bar and its own context, so focus and tab order in one cannot affect the other.
 */
const PreviewBar = (props: PropsWithChildren) => (
	<PositronActionBarContextProvider>
		{/* eslint-disable-next-line no-restricted-syntax -- the harness shows one control at a fixed width; overflow behavior is PositronDynamicActionBar's concern, not what this fixture is for. */}
		<PositronActionBar borderBottom borderTop paddingLeft={8} paddingRight={8}>
			{props.children}
		</PositronActionBar>
	</PositronActionBarContextProvider>
);

/**
 * Section component. One control: its knobs above, its preview bar below.
 */
const Section = (props: PropsWithChildren<{
	readonly title: string;
	readonly knobs: React.ReactNode;
}>) => (
	<div className='action-bar-controls-harness-section'>
		<div className='action-bar-controls-harness-section-title'>{props.title}</div>
		<div className='action-bar-controls-harness-toolbar'>{props.knobs}</div>
		<div className='action-bar-controls-harness-preview'>{props.children}</div>
	</div>
);

/**
 * CheckboxSection component.
 */
const CheckboxSection = () => {
	// State hooks.
	const [checked, setChecked] = useState(false);
	const [disabled, setDisabled] = useState(false);
	const [label, setLabel] = useState('Check Me!');

	// Reference hooks.
	const checkboxRef = useRef<HTMLButtonElement>(undefined!);

	// Render.
	return (
		<Section
			knobs={
				<>
					<TextKnob label='Label' value={label} onChange={setLabel} />
					<CheckKnob label='Checked' value={checked} onChange={setChecked} />
					<CheckKnob label='Disabled' value={disabled} onChange={setDisabled} />
				</>
			}
			title='Checkbox'
		>
			<PreviewBar>
				<RegisteredCheckbox
					ref={checkboxRef}
					checked={checked}
					disabled={disabled}
					label={label}
					onChanged={setChecked}
				/>
			</PreviewBar>
		</Section>
	);
};

/**
 * RegisteredCheckbox component. Registers the checkbox with its bar, which in the workbench is
 * ActionBarActionCheckbox's job.
 */
const RegisteredCheckbox = (props: {
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly label: string;
	readonly onChanged: (checked: boolean) => void;
	readonly ref: React.RefObject<HTMLButtonElement>;
}) => {
	// Participate in roving tabindex.
	useRegisterWithActionBar([props.ref]);

	// Render.
	return (
		<ActionBarCheckbox
			ref={props.ref}
			checked={props.checked}
			disabled={props.disabled}
			label={props.label}
			tooltip={props.label}
			onChanged={props.onChanged}
		/>
	);
};

/**
 * ToggleSection component.
 */
const ToggleSection = () => {
	// State hooks.
	const [toggled, setToggled] = useState(false);
	const [disabled, setDisabled] = useState(false);
	const [label, setLabel] = useState('Switch');
	const [leftTitle, setLeftTitle] = useState('Left');
	const [rightTitle, setRightTitle] = useState('Right');

	// Reference hooks.
	const toggleRef = useRef<HTMLButtonElement>(undefined!);

	// Render.
	return (
		<Section
			knobs={
				<>
					<TextKnob label='Label' value={label} onChange={setLabel} />
					<TextKnob label='Left title' value={leftTitle} onChange={setLeftTitle} />
					<TextKnob label='Right title' value={rightTitle} onChange={setRightTitle} />
					<CheckKnob label='Toggled' value={toggled} onChange={setToggled} />
					<CheckKnob label='Disabled' value={disabled} onChange={setDisabled} />
				</>
			}
			title='Toggle'
		>
			<PreviewBar>
				<RegisteredToggle
					ref={toggleRef}
					disabled={disabled}
					label={label}
					leftTitle={leftTitle}
					rightTitle={rightTitle}
					toggled={toggled}
					onChanged={setToggled}
				/>
			</PreviewBar>
		</Section>
	);
};

/**
 * RegisteredToggle component. Registers the toggle with its bar, which in the workbench is
 * ActionBarActionToggle's job. That component also builds the accessible name out of the left
 * title, because the left option is the one the switch reports as "on"; this mirrors it.
 */
const RegisteredToggle = (props: {
	readonly disabled: boolean;
	readonly label: string;
	readonly leftTitle: string;
	readonly rightTitle: string;
	readonly toggled: boolean;
	readonly onChanged: (toggled: boolean) => void;
	readonly ref: React.RefObject<HTMLButtonElement>;
}) => {
	// Participate in roving tabindex.
	useRegisterWithActionBar([props.ref]);

	// Render.
	return (
		<ActionBarToggle
			ref={props.ref}
			ariaLabel={props.leftTitle ? `${props.label}: ${props.leftTitle}` : props.label}
			disabled={props.disabled}
			leftTitle={props.leftTitle}
			rightTitle={props.rightTitle}
			toggled={props.toggled}
			tooltip={props.label}
			onChanged={props.onChanged}
		/>
	);
};

/**
 * PositronActionBarControlsHarness component. A configurable fixture for the action bar checkbox
 * and toggle. Nothing in the workbench renders either control today, so this is the only place
 * their markup, CSS and screen reader output can be checked.
 */
const PositronActionBarControlsHarness = () => (
	<div className='action-bar-controls-harness'>
		<CheckboxSection />
		<ToggleSection />
	</div>
);

controlGalleryRegistry.register({
	id: 'positronActionBarControls',
	label: 'Action Bar Controls',
	description: 'The checkbox and two-option toggle that extensions can put on the Editor Action Bar.',
	render: () => <PositronActionBarControlsHarness />
});
