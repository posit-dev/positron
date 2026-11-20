/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ImageDiffEditorInput, ImageDiffView, ImageObjectUrls, imageDiffProvider } from '../../browser/richDiff/imageDiffEditor.js';
import { IRichDiffSide, IRichDiffSides, richDiffRegistry } from '../../browser/richDiff/richDiffRegistry.js';

const before: IRichDiffSide = { bytes: VSBuffer.wrap(new Uint8Array(2048)), label: 'Before' };
const after: IRichDiffSide = { bytes: VSBuffer.wrap(new Uint8Array(4096)), label: 'After' };

describe('richDiffRegistry', () => {
	test('finds the provider by extension in any letter case, and nothing for other files', () => {
		const registration = richDiffRegistry.register(imageDiffProvider);
		try {
			expect([
				richDiffRegistry.find('figures/plot.png')?.id,
				richDiffRegistry.find('a/B.JPEG')?.id,
				richDiffRegistry.find('logo.svg')?.id,
				richDiffRegistry.find('dose.R')?.id,
				richDiffRegistry.find('Makefile')?.id,
				richDiffRegistry.find('png')?.id,
			]).toEqual(['image', 'image', 'image', undefined, undefined, undefined]);
		} finally {
			registration.dispose();
		}
		expect(richDiffRegistry.find('figures/plot.png')).toBeUndefined();
	});
});

describe('ImageObjectUrls', () => {
	test('creates one URL per side and revokes them when disposed', () => {
		const created: Blob[] = [];
		const revoked: string[] = [];
		const urls = new ImageObjectUrls(
			{ left: before, right: after, path: 'plot.png' },
			{ createObjectURL: blob => { created.push(blob); return `blob:${created.length}`; }, revokeObjectURL: url => revoked.push(url) },
		);

		expect({ left: urls.left, right: urls.right, types: created.map(blob => blob.type), revoked }).toEqual({ left: 'blob:1', right: 'blob:2', types: ['image/png', 'image/png'], revoked: [] });

		urls.dispose();

		expect(revoked).toEqual(['blob:1', 'blob:2']);
	});

	test('an absent side gets no URL', () => {
		const created: Blob[] = [];
		const urls = new ImageObjectUrls(
			{ right: after, path: 'logo.svg' },
			{ createObjectURL: blob => { created.push(blob); return 'blob:new'; }, revokeObjectURL: () => { } },
		);

		expect({ left: urls.left, right: urls.right, types: created.map(blob => blob.type) }).toEqual({ left: undefined, right: 'blob:new', types: ['image/svg+xml'] });
		urls.dispose();
	});
});

describe('ImageDiffView', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function urlsFor(sides: Pick<IRichDiffSides, 'left' | 'right'>) {
		const urls = new ImageObjectUrls({ ...sides, path: 'plot.png' }, { createObjectURL: blob => `blob:${blob.size}`, revokeObjectURL: () => { } });
		ctx.disposables.add(urls);
		return urls;
	}

	function show(sides: Pick<IRichDiffSides, 'left' | 'right'>) {
		rtl.render(<ImageDiffView left={sides.left} right={sides.right} urls={urlsFor(sides)} />);
		return userEvent.setup();
	}

	test('shows both images from their object URLs, labelled Before and After', () => {
		show({ left: before, right: after });

		expect([screen.getByRole('img', { name: 'Before' }), screen.getByRole('img', { name: 'After' })].map(image => image.getAttribute('src')))
			.toEqual(['blob:2048', 'blob:4096']);
	});

	test('shows the size in bytes, and in pixels once the image has loaded', () => {
		show({ left: before, right: after });
		const image = screen.getByRole('img', { name: 'Before' });

		expect(screen.getByText('2.00KB')).toBeInTheDocument();

		Object.defineProperty(image, 'naturalWidth', { value: 640 });
		Object.defineProperty(image, 'naturalHeight', { value: 480 });
		fireEvent.load(image);

		expect(screen.getByText('640 x 480 pixels, 2.00KB')).toBeInTheDocument();
		expect(screen.getByText('4.00KB')).toBeInTheDocument();
	});

	test('an added image says it is new on the left, and the slider is off', () => {
		show({ right: after });

		expect(screen.getByText('This image is new.')).toBeInTheDocument();
		expect(screen.getAllByRole('img').map(image => image.getAttribute('alt'))).toEqual(['After']);
		expect(screen.getByRole('radio', { name: 'Slider' })).toBeDisabled();
	});

	test('a removed image says it was removed on the right', () => {
		show({ left: before });

		expect(screen.getByText('This image was removed.')).toBeInTheDocument();
		expect(screen.getAllByRole('img').map(image => image.getAttribute('alt'))).toEqual(['Before']);
	});

	test('an image that fails to load says so and keeps its size', () => {
		show({ left: before, right: after });

		fireEvent.error(screen.getByRole('img', { name: 'After' }));

		expect(screen.getByRole('alert')).toHaveTextContent('This image could not be shown.');
		expect(screen.getByText('4.00KB')).toBeInTheDocument();
	});

	test('the slider mode stacks the two images and the range sets how much of After shows', async () => {
		const user = show({ left: before, right: after });

		await user.click(screen.getByRole('radio', { name: 'Slider' }));

		expect(screen.getByRole('radio', { name: 'Slider' })).toBeChecked();
		expect(screen.getByRole('radio', { name: 'Side by side' })).not.toBeChecked();
		expect(screen.getByRole('img', { name: 'After' })).toHaveStyle({ clipPath: 'inset(0 50% 0 0)' });

		// user-event cannot set the value of a range input.
		// eslint-disable-next-line testing-library/prefer-user-event
		fireEvent.change(screen.getByRole('slider', { name: 'How much of the After image shows' }), { target: { value: '80' } });

		expect(screen.getByRole('img', { name: 'After' })).toHaveStyle({ clipPath: 'inset(0 20% 0 0)' });

		await user.click(screen.getByRole('radio', { name: 'Side by side' }));

		expect(screen.queryByRole('slider')).not.toBeInTheDocument();
	});
});

describe('imageDiffProvider', () => {
	const openEditor = vi.fn(async () => undefined);
	const ctx = createTestContainer().stub(IEditorService, { openEditor }).build();

	test('opens an image comparison input that holds both sides', async () => {
		const sides: IRichDiffSides = { left: before, right: after, path: 'plot.png', title: 'plot.png (changes)' };

		await ctx.instantiationService.invokeFunction(accessor => imageDiffProvider.open(accessor, sides));

		const [input] = openEditor.mock.calls[0] as unknown as [ImageDiffEditorInput];
		expect({ isImageInput: input instanceof ImageDiffEditorInput, sides: input.sides, name: input.getName() }).toEqual({ isImageInput: true, sides, name: 'plot.png (changes)' });
		input.dispose();
	});
});
