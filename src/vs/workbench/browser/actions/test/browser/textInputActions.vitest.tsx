/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { createTextInputActions } from '../../textInputActions.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';

describe('createTextInputActions paste', () => {
	const PASTE_ACTION_ID = 'editor.action.clipboardPasteAction';
	const PASTED_TEXT = 'https://github.com/posit-dev/positron-website.git';

	const buildPasteAction = () => {
		const clipboardService = stubInterface<IClipboardService>({
			readText: vi.fn().mockResolvedValue(PASTED_TEXT),
		});
		const actions = createTextInputActions(clipboardService, new NullLogService());
		return actions.find(a => a.id === PASTE_ACTION_ID)!;
	};

	// See posit-dev/positron#12204: assigning element.value directly causes
	// React's patched setter to update its value tracker, so the subsequent
	// input event is treated as a no-op and onChange never fires. The paste
	// action must use the native value setter so React state stays in sync.
	it('fires onChange in a controlled React <input>', async () => {
		const onChange = vi.fn();
		const ControlledInput = () => {
			const [value, setValue] = useState('');
			return (
				<input
					aria-label='repo-url'
					value={value}
					onChange={e => {
						onChange(e.target.value);
						setValue(e.target.value);
					}}
				/>
			);
		};

		render(<ControlledInput />);
		const input = screen.getByLabelText('repo-url') as HTMLInputElement;

		await act(async () => {
			await buildPasteAction().run(input);
		});

		expect(onChange).toHaveBeenCalledWith(PASTED_TEXT);
		expect(input).toHaveValue(PASTED_TEXT);
	});

	it('fires onChange in a controlled React <textarea>', async () => {
		const onChange = vi.fn();
		const ControlledTextarea = () => {
			const [value, setValue] = useState('');
			return (
				<textarea
					aria-label='notes'
					value={value}
					onChange={e => {
						onChange(e.target.value);
						setValue(e.target.value);
					}}
				/>
			);
		};

		render(<ControlledTextarea />);
		const textarea = screen.getByLabelText('notes') as HTMLTextAreaElement;

		await act(async () => {
			await buildPasteAction().run(textarea);
		});

		expect(onChange).toHaveBeenCalledWith(PASTED_TEXT);
		expect(textarea).toHaveValue(PASTED_TEXT);
	});

	it('inserts at the selection range and preserves surrounding text', async () => {
		const ControlledInput = () => {
			const [value, setValue] = useState('prefix-suffix');
			return (
				<input
					aria-label='ranged'
					value={value}
					onChange={e => setValue(e.target.value)}
				/>
			);
		};

		render(<ControlledInput />);
		const input = screen.getByLabelText('ranged') as HTMLInputElement;
		input.setSelectionRange(7, 7); // caret between "prefix-" and "suffix"

		await act(async () => {
			await buildPasteAction().run(input);
		});

		expect(input).toHaveValue(`prefix-${PASTED_TEXT}suffix`);
	});

	it('is a no-op when the target is not an input or textarea', async () => {
		render(<div aria-label='not-input'>untouched</div>);
		const div = screen.getByLabelText('not-input');

		await act(async () => {
			await buildPasteAction().run(div);
		});

		expect(div).toHaveTextContent('untouched');
	});
});
