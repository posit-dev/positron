/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { PreviewOverlayWebview } from '../../browser/previewOverlayWebview.js';
import { PreviewUrl } from '../../browser/previewUrl.js';

describe('PreviewUrl', () => {
	const disposables = ensureNoLeakedDisposables();

	it('reports navigations without the cache-busting parameter it added', () => {
		const onDidNavigate = disposables.add(new Emitter<URI>());
		const webview = stubInterface<IOverlayWebview>({
			onDidNavigate: onDidNavigate.event,
			onDidDispose: Event.None,
			onDidLoad: Event.None,
			setHtml: () => { },
			dispose: () => { },
		});
		const preview = disposables.add(new PreviewUrl('previewUrl.1', new PreviewOverlayWebview(webview), URI.parse('http://localhost:8000/?a=1')));
		const reported: string[] = [];
		disposables.add(preview.onDidNavigate(uri => reported.push(uri.toString(true))));

		onDidNavigate.fire(URI.parse('http://localhost:8000/?a=1&_positronRender=0'));
		onDidNavigate.fire(URI.parse('http://localhost:8000/?_positronRender=1&b=2'));
		onDidNavigate.fire(URI.parse('http://localhost:8000/page'));

		expect({ reported, current: preview.currentUri.toString(true) }).toEqual({
			reported: ['http://localhost:8000/?a=1', 'http://localhost:8000/?b=2', 'http://localhost:8000/page'],
			current: 'http://localhost:8000/page',
		});
	});
});
