/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { RuntimeMessageEmitter } from '../RuntimeMessageEmitter';
import { JupyterMessage } from '../jupyter/JupyterMessage';
import { JupyterMessageType } from '../jupyter/JupyterMessageType';
import { JupyterMessageHeader } from '../jupyter/JupyterMessageHeader';

function header(msg_type: JupyterMessageType): JupyterMessageHeader {
	return {
		msg_id: 'test-msg-id',
		session: 'test-session',
		username: 'test-user',
		date: '2026-01-01T00:00:00.000Z',
		msg_type,
		version: '5.3',
	};
}

function makeMessage(
	msg_type: JupyterMessageType,
	content: unknown,
	metadata: Record<string, unknown> = {},
): JupyterMessage {
	return {
		header: header(msg_type),
		parent_header: header(msg_type),
		metadata,
		content,
		channel: 'iopub' as JupyterMessage['channel'],
		buffers: [],
	};
}

suite('RuntimeMessageEmitter', () => {
	// The retina dimensions IPython attaches to a display_data/execute_result
	// message's `metadata` field, keyed by MIME type.
	const retinaMetadata = { 'image/png': { width: 50, height: 50 } };

	test('display_data routes output-level metadata to outputMetadata', () => {
		const emitter = new RuntimeMessageEmitter();
		let fired: positron.LanguageRuntimeOutput | undefined;
		emitter.event(e => { fired = e as positron.LanguageRuntimeOutput; });

		emitter.emitJupyter(makeMessage(JupyterMessageType.DisplayData, {
			data: { 'image/png': 'base64data' },
			metadata: retinaMetadata,
		}));

		assert.strictEqual(fired?.type, positron.LanguageRuntimeMessageType.Output);
		// Output-level metadata lands on `outputMetadata`...
		assert.deepStrictEqual(fired?.outputMetadata, retinaMetadata);
		// ...and the message-level `metadata` is preserved separately (no overwrite).
		assert.deepStrictEqual(fired?.metadata, {});
	});

	test('execute_result routes output-level metadata to outputMetadata', () => {
		const emitter = new RuntimeMessageEmitter();
		let fired: positron.LanguageRuntimeResult | undefined;
		emitter.event(e => { fired = e as positron.LanguageRuntimeResult; });

		emitter.emitJupyter(makeMessage(JupyterMessageType.ExecuteResult, {
			data: { 'image/png': 'base64data' },
			metadata: retinaMetadata,
			execution_count: 1,
		}));

		assert.strictEqual(fired?.type, positron.LanguageRuntimeMessageType.Result);
		assert.deepStrictEqual(fired?.outputMetadata, retinaMetadata);
		assert.deepStrictEqual(fired?.metadata, {});
		assert.strictEqual(fired?.execution_count, 1);
	});

	test('message-level metadata is not overwritten by output-level metadata', () => {
		const emitter = new RuntimeMessageEmitter();
		let fired: positron.LanguageRuntimeOutput | undefined;
		emitter.event(e => { fired = e as positron.LanguageRuntimeOutput; });

		// A message-level metadata key that also appears at the output level
		// must not be clobbered now that the two are kept in distinct fields.
		const messageMetadata = { 'image/png': 'message-level' };
		emitter.emitJupyter(makeMessage(JupyterMessageType.DisplayData, {
			data: { 'image/png': 'base64data' },
			metadata: retinaMetadata,
		}, messageMetadata));

		assert.deepStrictEqual(fired?.metadata, messageMetadata);
		assert.deepStrictEqual(fired?.outputMetadata, retinaMetadata);
	});
});
