/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { act, configure, getConfig, screen } from '@testing-library/react';
import { userEvent, UserEvent } from '@testing-library/user-event';
import { mainWindow } from '../../../../../base/browser/window.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { PlotPreviewStatus, PlotSizeEditor, PlotSizeEditorProps } from '../../browser/modalDialogs/plotSizeEditor.js';

describe('PlotSizeEditor', () => {
	const rtl = setupRTLRenderer();

	// RTL's default async wrapper only advances Jest timers, so advance Vitest's clock instead.
	const asyncWrapper = getConfig().asyncWrapper;
	beforeEach(() => {
		vi.useFakeTimers();
		configure({
			asyncWrapper: async callback => {
				const result = await callback();
				await vi.advanceTimersByTimeAsync(0);
				return result;
			}
		});
	});

	afterEach(() => {
		configure({ asyncWrapper });
		vi.useRealTimers();
	});

	const advance = (ms: number) => act(() => {
		vi.advanceTimersByTime(ms);
	});

	function renderEditor(overrides: Partial<PlotSizeEditorProps> = {}) {
		const onCommit = vi.fn();
		const onValidityChange = vi.fn();
		const onKeepRatioChange = vi.fn();
		const onFrameSizeChange = vi.fn();
		const props: PlotSizeEditorProps = {
			initialSize: { width: 400, height: 200 },
			keepRatio: false,
			onKeepRatioChange,
			maxDragSize: { width: 1100, height: 700 },
			previewAlt: 'plot()',
			status: 'idle',
			onCommit,
			onValidityChange,
			onFrameSizeChange,
			...overrides,
		};
		const result = rtl.render(<PlotSizeEditor {...props} />);
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const rerender = (next: Partial<PlotSizeEditorProps>) =>
			result.rerender(<PlotSizeEditor {...props} {...next} />);
		return { user, onCommit, onValidityChange, onKeepRatioChange, onFrameSizeChange, rerender };
	}

	const widthBox = () => screen.getByRole('spinbutton', { name: 'Width' });
	const heightBox = () => screen.getByRole('spinbutton', { name: 'Height' });
	const handle = () => screen.getByRole('button', { name: 'Resize plot' });

	async function retype(user: UserEvent, input: HTMLElement, text: string) {
		await user.clear(input);
		await user.type(input, text);
	}

	it('commits a typed width after 300 ms', async () => {
		const { user, onCommit } = renderEditor();

		await retype(user, widthBox(), '640');
		advance(299);
		expect(onCommit).not.toHaveBeenCalled();

		advance(1);
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith({ width: 640, height: 200 }, 'typed');
	});

	it('commits at once on Enter', async () => {
		const { user, onCommit } = renderEditor();

		await retype(user, widthBox(), '640');
		await user.keyboard('{Enter}');

		expect(onCommit).toHaveBeenCalledWith({ width: 640, height: 200 }, 'typed');
		advance(300);
		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it('does not commit on Tab from width to height', async () => {
		const { user, onCommit } = renderEditor();

		await retype(user, widthBox(), '640');
		await user.tab();

		expect(heightBox()).toHaveFocus();
		expect(onCommit).not.toHaveBeenCalled();
	});

	it('commits on Tab out of height', async () => {
		const { user, onCommit } = renderEditor();

		await retype(user, heightBox(), '300');
		await user.tab();

		expect(heightBox()).not.toHaveFocus();
		expect(onCommit).toHaveBeenCalledWith({ width: 400, height: 300 }, 'typed');
	});

	it('does not commit the same size twice', async () => {
		const { user, onCommit } = renderEditor();

		await retype(user, widthBox(), '640');
		await user.keyboard('{Enter}');
		await retype(user, widthBox(), '640');
		await user.keyboard('{Enter}');
		advance(300);

		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it('does not commit the initial size', async () => {
		const { user, onCommit } = renderEditor();

		await retype(user, widthBox(), '400');
		advance(300);

		expect(onCommit).not.toHaveBeenCalled();
	});

	it('keeps the ratio while typing', async () => {
		const { user, onCommit } = renderEditor({ keepRatio: true });

		await retype(user, widthBox(), '800');
		advance(300);

		expect(heightBox()).toHaveValue(400);
		expect(onCommit).toHaveBeenLastCalledWith({ width: 800, height: 400 }, 'typed');
	});

	it('shows an error and keeps the number when the linked box goes out of range', async () => {
		const { user, onCommit, onValidityChange } = renderEditor({ keepRatio: true });

		await retype(user, widthBox(), '100');
		advance(300);

		expect(widthBox()).toHaveValue(100);
		expect(heightBox()).toHaveValue(50);
		expect(heightBox()).toHaveAttribute('aria-invalid', 'true');
		expect(heightBox()).toHaveAccessibleDescription('Enter at least 100 px.');
		expect(widthBox()).toHaveAttribute('aria-invalid', 'false');
		expect(onValidityChange).toHaveBeenLastCalledWith(false);
		expect(onCommit).not.toHaveBeenCalledWith({ width: 100, height: 50 }, 'typed');
	});

	it('rejects empty and non-numeric input', async () => {
		const { user, onCommit, onValidityChange } = renderEditor();

		await user.clear(widthBox());
		await user.keyboard('{Enter}');
		advance(300);

		expect(widthBox()).toHaveAttribute('aria-invalid', 'true');
		expect(widthBox()).toHaveAccessibleDescription('Enter a number.');
		expect(onValidityChange).toHaveBeenLastCalledWith(false);

		await user.type(widthBox(), 'abc');
		advance(300);
		expect(widthBox()).toHaveAttribute('aria-invalid', 'true');

		await user.type(widthBox(), '640.9');
		await user.keyboard('{Enter}');
		expect(widthBox()).toHaveAttribute('aria-invalid', 'false');
		expect(onValidityChange).toHaveBeenLastCalledWith(true);
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith({ width: 640, height: 200 }, 'typed');
	});

	it('handle arrow keys resize by 10 and 50 and commit as drag', async () => {
		const { user, onCommit } = renderEditor();

		handle().focus();
		await user.keyboard('{ArrowRight}');
		expect(widthBox()).toHaveValue(410);
		await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
		expect(heightBox()).toHaveValue(250);
		expect(onCommit).not.toHaveBeenCalled();

		advance(300);
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith({ width: 410, height: 250 }, 'drag');
	});

	it('pointer drag commits once on release, as drag', async () => {
		const { user, onCommit } = renderEditor();
		const frame = screen.getByTestId('plot-size-frame');

		await user.pointer([
			{ keys: '[MouseLeft>]', target: handle(), coords: { clientX: 500, clientY: 300 } },
			{ target: handle(), coords: { clientX: 550, clientY: 320 } },
			{ target: handle(), coords: { clientX: 600, clientY: 340 } },
		]);

		// The frame and the boxes follow the pointer during the drag, without a commit.
		expect(frame).toHaveStyle({ width: '500px', height: '240px' });
		expect(widthBox()).toHaveValue(500);
		expect(onCommit).not.toHaveBeenCalled();

		await user.pointer({ keys: '[/MouseLeft]', target: handle(), coords: { clientX: 600, clientY: 340 } });
		advance(300);

		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith({ width: 500, height: 240 }, 'drag');
	});

	it('the frame shows the last committed size, not the typed one', async () => {
		const { user } = renderEditor();
		const frame = screen.getByTestId('plot-size-frame');

		await retype(user, widthBox(), '640');
		expect(frame).toHaveStyle({ width: '400px', height: '200px' });

		await user.keyboard('{Enter}');
		expect(frame).toHaveStyle({ width: '640px', height: '200px' });
	});

	it('shows the scaled note when the size exceeds maxDragSize', async () => {
		const { user } = renderEditor();
		const frame = screen.getByTestId('plot-size-frame');

		expect(screen.queryByText(/Preview scaled to fit/)).not.toBeInTheDocument();

		await retype(user, widthBox(), '2200');
		await user.keyboard('{Enter}');

		expect(screen.getByText('Preview scaled to fit. The copy is 2200 x 200 px.')).toBeInTheDocument();
		expect(frame).toHaveStyle({ width: '1100px', height: '100px' });
	});

	it('shows the preview image, or an empty frame without one', () => {
		const { rerender } = renderEditor();
		expect(screen.queryByRole('img')).not.toBeInTheDocument();

		rerender({ previewUri: 'data:image/png;base64,AA==' });
		expect(screen.getByRole('img', { name: 'plot()' })).toHaveAttribute('src', 'data:image/png;base64,AA==');
	});

	it('shows the waiting and unavailable notes', () => {
		const { rerender } = renderEditor({ status: 'waiting' });
		// Each size box has its own status region for errors, so find the note by its text.
		expect(screen.getByText('Waiting for the console to finish')).toHaveAttribute('role', 'status');

		rerender({ status: 'unavailable' as PlotPreviewStatus });
		expect(screen.getByText('This plot is no longer available')).toHaveAttribute('role', 'status');
		expect(screen.queryByText('Waiting for the console to finish')).not.toBeInTheDocument();
	});

	it('shows the progress bar while drawing', () => {
		const { rerender } = renderEditor();
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

		rerender({ status: 'drawing' });
		expect(screen.getByRole('progressbar')).toBeInTheDocument();
	});

	it('the checkbox change calls onKeepRatioChange', async () => {
		const { user, onKeepRatioChange } = renderEditor({ keepRatio: true });

		await user.click(screen.getByRole('checkbox', { name: 'Maintain aspect ratio' }));

		expect(onKeepRatioChange).toHaveBeenCalledWith(false);
	});

	it('does not let Enter in the size boxes bubble out of the editor', async () => {
		const { user } = renderEditor();
		// React handles events at its root, so listen outside the root, as a host would.
		const hostKeyDown = vi.fn();
		document.body.addEventListener('keydown', hostKeyDown);
		try {
			await retype(user, widthBox(), '640');
			expect(hostKeyDown).toHaveBeenCalled();
			hostKeyDown.mockClear();
			await user.keyboard('{Enter}');

			expect(hostKeyDown).not.toHaveBeenCalled();
		} finally {
			document.body.removeEventListener('keydown', hostKeyDown);
		}
	});

	it('a click on the handle without moving does not commit the scaled frame size', async () => {
		const { user, onCommit } = renderEditor();
		await retype(user, widthBox(), '2200');
		await user.keyboard('{Enter}');
		onCommit.mockClear();

		await user.pointer([
			{ keys: '[MouseLeft>]', target: handle(), coords: { clientX: 500, clientY: 300 } },
			{ keys: '[/MouseLeft]', target: handle(), coords: { clientX: 500, clientY: 300 } },
		]);
		advance(300);

		expect(onCommit).not.toHaveBeenCalled();
		expect(widthBox()).toHaveValue(2200);
	});

	it('handle arrow keys step from the real size when the frame is scaled', async () => {
		const { user, onCommit } = renderEditor();

		await retype(user, widthBox(), '2200');
		await user.keyboard('{Enter}');
		onCommit.mockClear();

		handle().focus();
		await user.keyboard('{ArrowRight}');
		advance(300);

		expect(onCommit).toHaveBeenCalledWith({ width: 2210, height: 200 }, 'drag');
		expect(screen.getByText('Preview scaled to fit. The copy is 2210 x 200 px.')).toBeInTheDocument();
	});

	it('reports the frame size on mount, during a drag, and scaled after a large commit', async () => {
		const { user, onFrameSizeChange } = renderEditor();
		expect(onFrameSizeChange).toHaveBeenLastCalledWith({ width: 400, height: 200 });

		await user.pointer([
			{ keys: '[MouseLeft>]', target: handle(), coords: { clientX: 500, clientY: 300 } },
			{ target: handle(), coords: { clientX: 550, clientY: 320 } },
		]);
		expect(onFrameSizeChange).toHaveBeenLastCalledWith({ width: 450, height: 220 });
		await user.pointer({ keys: '[/MouseLeft]', target: handle(), coords: { clientX: 550, clientY: 320 } });

		await retype(user, widthBox(), '2200');
		await retype(user, heightBox(), '200');
		await user.keyboard('{Enter}');
		expect(onFrameSizeChange).toHaveBeenLastCalledWith({ width: 1100, height: 100 });
	});

	it('keeps the status live region rendered and shown while idle', () => {
		const style = document.createElement('style');
		style.textContent = readFileSync(`${import.meta.dirname}/../../browser/modalDialogs/plotSizeEditor.css`, 'utf8');
		document.head.appendChild(style);
		try {
			renderEditor();
			const status = screen.getAllByRole('status').find(e => e.classList.contains('plot-size-status'));
			expect(status).toBeInTheDocument();
			expect(status).toBeEmptyDOMElement();
			expect(mainWindow.getComputedStyle(status!).display).not.toBe('none');
		} finally {
			style.remove();
		}
	});
});
