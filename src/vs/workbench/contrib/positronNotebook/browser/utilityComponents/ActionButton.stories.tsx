/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ActionButton } from './ActionButton.js';

const meta = {
	title: 'Notebook/ActionButton',
	component: ActionButton,
} satisfies Meta<typeof ActionButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
	args: {
		children: 'Run Cell',
	},
} satisfies Story;

export const WithClassName = {
	args: {
		children: 'Run Cell',
		className: 'custom-class',
	},
} satisfies Story;

export const Disabled = {
	args: {
		children: 'Run Cell',
		disabled: true,
	},
} satisfies Story;
