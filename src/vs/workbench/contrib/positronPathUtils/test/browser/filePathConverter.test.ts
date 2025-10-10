/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { convertClipboardFiles } from '../../common/filePathConverter.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

/**
 * Mock DataTransfer for testing clipboard file conversion.
 */
class MockDataTransfer implements DataTransfer {
	dropEffect: 'none' | 'copy' | 'link' | 'move' = 'none';
	effectAllowed: 'none' | 'copy' | 'copyLink' | 'copyMove' | 'link' | 'linkMove' | 'move' | 'all' | 'uninitialized' = 'uninitialized';
	files: FileList = new MockFileList([]);
	items: DataTransferItemList = new MockDataTransferItemList();
	types: readonly string[] = [];

	private data: Map<string, string> = new Map();

	constructor(uriList?: string[], textData?: string) {
		if (uriList && uriList.length > 0) {
			const uriListString = uriList.join('\n');
			this.data.set('text/uri-list', uriListString);
			this.types = ['text/uri-list'];
		} else if (textData) {
			this.data.set('text/plain', textData);
			this.types = ['text/plain'];
		}
	}

	clearData(format?: string): void {
		if (format) {
			this.data.delete(format);
		} else {
			this.data.clear();
		}
	}

	getData(format: string): string {
		return this.data.get(format) || '';
	}

	setData(format: string, data: string): void {
		this.data.set(format, data);
	}

	setDragImage(image: Element, x: number, y: number): void {
		// Mock implementation
	}
}

class MockFileList implements FileList {
	[index: number]: File;
	length: number = 0;

	constructor(files: File[]) {
		files.forEach((file, index) => {
			this[index] = file;
		});
		this.length = files.length;
	}

	item(index: number): File | null {
		return this[index] || null;
	}

	[Symbol.iterator](): IterableIterator<File> {
		let index = 0;
		return {
			next: (): IteratorResult<File> => {
				if (index < this.length) {
					return { value: this[index++], done: false };
				} else {
					return { done: true, value: undefined as any };
				}
			},
			[Symbol.iterator](): IterableIterator<File> {
				return this;
			}
		};
	}
}

class MockDataTransferItemList implements DataTransferItemList {
	[index: number]: DataTransferItem;
	length: number = 0;

	add(data: string, type: string): DataTransferItem | null;
	add(data: File): DataTransferItem | null;
	add(data: string | File, type?: string): DataTransferItem | null {
		// Mock implementation
		return null;
	}

	clear(): void {
		// Mock implementation
	}

	remove(index: number): void {
		// Mock implementation
	}

	[Symbol.iterator](): IterableIterator<DataTransferItem> {
		// Mock implementation
		return [][Symbol.iterator]();
	}
}

suite('File Path Converter Tests', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// Inputs largely based on real-world examples captured in the debugger on Windows

	test('Convert a single Windows file path', () => {
		const dataTransfer = new MockDataTransfer(['file:///c%3A/Users/test/file.txt']);
		const result = convertClipboardFiles(dataTransfer);
		assert.deepStrictEqual(result, ['"c:/Users/test/file.txt"']);
	});

	test('Convert multiple Windows file paths', () => {
		const dataTransfer = new MockDataTransfer([
			'file:///c%3A/Users/test/file1.txt',
			'file:///c%3A/Users/test/file2.txt'
		]);
		const result = convertClipboardFiles(dataTransfer);
		assert.deepStrictEqual(result, ['"c:/Users/test/file1.txt"', '"c:/Users/test/file2.txt"']);
	});

	test('Convert a file path with a space', () => {
		const dataTransfer = new MockDataTransfer(['file:///c%3A/Users/My%20Documents/file.txt']);
		const result = convertClipboardFiles(dataTransfer);
		assert.deepStrictEqual(result, ['"c:/Users/My Documents/file.txt"']);
	});

	// TODO @jennybc: revisit this test when I can get a real-world example
	// on macOS. You can't actually use `"` in a file path on Windows."
	test('File path with quotes is escaped correctly', () => {
		const dataTransfer = new MockDataTransfer(['file:///c%3A/Users/My%20%22Special%22%20File.txt']);
		const result = convertClipboardFiles(dataTransfer);
		assert.deepStrictEqual(result, ['"c:/Users/My \\"Special\\" File.txt"']);
	});

	test('UNC path (URI-decoded format) is skipped entirely', () => {
		// This tests the real-world scenario where \\localhost\C$\path becomes localhost/C$/path after URI decoding
		const dataTransfer = new MockDataTransfer(['file://localhost/C$/Users/test/file.txt']);
		const result = convertClipboardFiles(dataTransfer);
		assert.strictEqual(result, null);
	});

	test('Mixed regular and UNC paths skips all conversion', () => {
		const dataTransfer = new MockDataTransfer([
			'file:///c%3A/Users/test/file.txt',
			'file://localhost/C$/Users/test/file.txt'
		]);
		const result = convertClipboardFiles(dataTransfer);
		assert.strictEqual(result, null);
	});

	test('No files in clipboard returns null', () => {
		const dataTransfer = new MockDataTransfer([], 'some text content');
		const result = convertClipboardFiles(dataTransfer);
		assert.strictEqual(result, null);
	});

	test('Empty clipboard returns null', () => {
		const dataTransfer = new MockDataTransfer();
		const result = convertClipboardFiles(dataTransfer);
		assert.strictEqual(result, null);
	});

	test('Non-file URIs are filtered out', () => {
		const dataTransfer = new MockDataTransfer([
			'file:///c%3A/Users/test/file.txt',
			'https://example.com/not-a-file'
		]);
		const result = convertClipboardFiles(dataTransfer);
		assert.deepStrictEqual(result, ['"C:/Users/test/file.txt"']);
	});
});
