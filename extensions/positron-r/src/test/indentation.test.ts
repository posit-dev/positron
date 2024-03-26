import * as assert from 'assert';
import { withRandomFileEditor, CURSOR, type } from './editor-utils';

suite('Indentation', () => {
	test('test', async () => {
		return withRandomFileEditor(`1 +${CURSOR}`, 'R', async (_editor, document) => {
			await type(document, '\n2');
			assert.strictEqual(document.getText(), '1 +\n  2');
		});
	});
});
