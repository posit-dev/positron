/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { IconedButton } from './IconedButton.js';
import { Codicon } from '../../../../../base/common/codicons.js';

const meta = {
	title: 'Notebook/IconedButton',
	component: IconedButton,
} satisfies Meta<typeof IconedButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default = {
	args: {
		icon: Codicon.play,
		label: 'Run Cell',
		onClick: () => { },
	},
} satisfies Story;

export const Bordered = {
	args: {
		icon: Codicon.plus,
		label: 'Code',
		fullLabel: 'New Code Cell',
		onClick: () => { },
		bordered: true,
	},
} satisfies Story;

export const WithHoverManager = {
	args: {
		icon: Codicon.markdown,
		label: 'Markdown',
		fullLabel: 'New Markdown Cell',
		onClick: () => { },
		bordered: true,
	},
} satisfies Story;
