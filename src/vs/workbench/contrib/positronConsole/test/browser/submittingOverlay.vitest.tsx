/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SubmittingOverlay } from '../../browser/components/submittingOverlay.js';

describe('SubmittingOverlay', () => {
	it('renders nothing when not visible', () => {
		const { container } = render(<SubmittingOverlay visible={false} onCancel={vi.fn()} />);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders the label and Cancel button when visible', () => {
		render(<SubmittingOverlay visible={true} onCancel={vi.fn()} />);
		// The label text is split into per-character spans for the wave
		// animation; the accessible name lives on the status role.
		expect(screen.getByRole('status', { name: 'Submitting...' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
	});

	it('calls onCancel when the Cancel button is clicked', async () => {
		const onCancel = vi.fn();
		const user = userEvent.setup();
		render(<SubmittingOverlay visible={true} onCancel={onCancel} />);
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
