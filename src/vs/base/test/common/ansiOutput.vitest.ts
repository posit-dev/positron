/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { ANSIColor, ANSIFormat, ANSIOutput, ANSIStyle } from '../../common/ansiOutput.js';

//#region Test Helpers

/**
 * Constants.
 */
/// <reference types="vitest/globals" />
const BS = '\b';
const CR = '\r';
const LF = '\n';
const CRLF = `\r\n`;
const PANGRAM = 'The quick brown fox jumps over the lazy dog';

/**
 * Gets one of the possible CSI values in an alternating fashion to increase test coverage.
 */
/// <reference types="vitest/globals" />
let csiIndex = 0;
const CSI = () => {
	switch (csiIndex) {
		case 0:
			csiIndex++;
			return '\x1b[';
		default:
			csiIndex = 0;
			return '\x9b';
	}
};

/**
 * Gets one of the possible OSC values in an alternating fashion to increase test coverage.
 */
/// <reference types="vitest/globals" />
let oscIndex = 0;
const OSC = () => {
	switch (oscIndex) {
		case 0:
			oscIndex++;
			return '\x1b]';
		default:
			oscIndex = 0;
			return '\x9d';
	}
};

/**
 * Gets one of the possible ST values in an alternating fashion to increase test coverage.
 */
/// <reference types="vitest/globals" />
let stIndex = 0;
const ST = () => {
	switch (stIndex) {
		case 0:
			stIndex++;
			return '\x1b\x5c';
		case 1:
			stIndex++;
			return '\x07';
		default:
			stIndex = 0;
			return '\x9c';
	}
};

/**
 * SGR (Select Graphic Rendition).
 */
/// <reference types="vitest/globals" />
enum SGRParam {
	Reset = 0,
	Bold = 1,
	Dim = 2,
	Italic = 3,
	Underlined = 4,
	SlowBlink = 5,
	RapidBlink = 6,
	Reversed = 7,
	Hidden = 8,
	CrossedOut = 9,
	PrimaryFont = 10,
	AlternativeFont1 = 11,
	AlternativeFont2 = 12,
	AlternativeFont3 = 13,
	AlternativeFont4 = 14,
	AlternativeFont5 = 15,
	AlternativeFont6 = 16,
	AlternativeFont7 = 17,
	AlternativeFont8 = 18,
	AlternativeFont9 = 19,
	Fraktur = 20,
	DoubleUnderlined = 21,
	NormalIntensity = 22,
	NotItalicNotFraktur = 23,
	NotUnderlined = 24,
	NotBlinking = 25,
	ProportionalSpacing = 26,
	NotReversed = 27,
	Reveal = 28,
	NotCrossedOut = 29,
	ForegroundBlack = 30,
	ForegroundRed = 31,
	ForegroundGreen = 32,
	ForegroundYellow = 33,
	ForegroundBlue = 34,
	ForegroundMagenta = 35,
	ForegroundCyan = 36,
	ForegroundWhite = 37,
	SetForeground = 38,
	DefaultForeground = 39,
	BackgroundBlack = 40,
	BackgroundRed = 41,
	BackgroundGreen = 42,
	BackgroundYellow = 43,
	BackgroundBlue = 44,
	BackgroundMagenta = 45,
	BackgroundCyan = 46,
	BackgroundWhite = 47,
	SetBackground = 48,
	DefaultBackground = 49,
	DisableProportionalSpacing = 50,
	Framed = 51,
	Encircled = 52,
	Overlined = 53,
	NotFramedNotEncircled = 54,
	NotOverlined = 55,
	// 56 unsupported
	// 57 unsupported
	SetUnderline = 58,
	DefaultUnderline = 59,
	IdeogramUnderlineOrRightSideLine = 60,
	IdeogramDoubleUnderlineOrDoubleRightSideLine = 61,
	IdeogramOverlineOrLeftSideLine = 62,
	IdeogramDoubleOverlineOrDoubleLeftSideLine = 63,
	IdeogramStressMarking = 64,
	NoIdeogramAttributes = 65,
	// 66 unsupported
	// 67 unsupported
	// 68 unsupported
	// 69 unsupported
	// 70 unsupported
	// 71 unsupported
	// 72 unsupported
	Superscript = 73,
	Subscript = 74,
	NotSuperscriptNotSubscript = 75,
	// 76 unsupported
	// 77 unsupported
	// 78 unsupported
	// 79 unsupported
	// 80 unsupported
	// 81 unsupported
	// 82 unsupported
	// 83 unsupported
	// 84 unsupported
	// 85 unsupported
	// 86 unsupported
	// 87 unsupported
	// 88 unsupported
	// 89 unsupported
	ForegroundBrightBlack = 90,
	ForegroundBrightRed = 91,
	ForegroundBrightGreen = 92,
	ForegroundBrightYellow = 93,
	ForegroundBrightBlue = 94,
	ForegroundBrightMagenta = 95,
	ForegroundBrightCyan = 96,
	ForegroundBrightWhite = 97,
	// 98 unsupported
	// 99 unsupported
	BackgroundBrightBlack = 100,
	BackgroundBrightRed = 101,
	BackgroundBrightGreen = 102,
	BackgroundBrightYellow = 103,
	BackgroundBrightBlue = 104,
	BackgroundBrightMagenta = 105,
	BackgroundBrightCyan = 106,
	BackgroundBrightWhite = 107
}

/**
 * SGRParamColor enumeration.
 */
/// <reference types="vitest/globals" />
enum SGRParamColor {
	Color256 = 5,
	ColorRGB = 2
}

/**
 * SGRValue type.
 */
/// <reference types="vitest/globals" />
type SGRValue = SGRParam | SGRParamColor | number;

/**
 * SGRTestScenario interface.
 */
/// <reference types="vitest/globals" />
interface SGRTestScenario {
	sgr: SGRValue[];
	ansiFormat: ANSIFormat;
}

/**
 * Maps an 8-bit color index to an ANSIColor or RGB color value.
 * @param colorIndex The 8-bit color index.
 * @returns An ANSIColor or RGB color value.
 */
/// <reference types="vitest/globals" />
const map8BitColorIndexToColor = (colorIndex: number) => {
	// Process the color index. The first 16 indexes map to normal ANSIColors.
	switch (colorIndex) {
		case 0:
			return ANSIColor.Black;

		case 1:
			return ANSIColor.Red;

		case 2:
			return ANSIColor.Green;

		case 3:
			return ANSIColor.Yellow;

		case 4:
			return ANSIColor.Blue;

		case 5:
			return ANSIColor.Magenta;

		case 6:
			return ANSIColor.Cyan;

		case 7:
			return ANSIColor.White;

		case 8:
			return ANSIColor.BrightBlack;

		case 9:
			return ANSIColor.BrightRed;

		case 10:
			return ANSIColor.BrightGreen;

		case 11:
			return ANSIColor.BrightYellow;

		case 12:
			return ANSIColor.BrightBlue;

		case 13:
			return ANSIColor.BrightMagenta;

		case 14:
			return ANSIColor.BrightCyan;

		case 15:
			return ANSIColor.BrightWhite;

		// Process other color indexes.
		default:
			// Sanity check that the color index is an integer.
			if (colorIndex % 1 !== 0) {
				return undefined;
			}

			// Process the color index as RGB or grayscale.
			if (colorIndex >= 16 && colorIndex <= 231) {
				// Convert the color index to one of 216 RGB colors.
				let colorNumber = colorIndex - 16;
				let blue = colorNumber % 6;
				colorNumber = (colorNumber - blue) / 6;
				let green = colorNumber % 6;
				colorNumber = (colorNumber - green) / 6;
				let red = colorNumber;

				// Map red, green, and blue from 0-5 to 0-255.
				blue = Math.round(blue * 255 / 5);
				green = Math.round(green * 255 / 5);
				red = Math.round(red * 255 / 5);

				// Return the RGB color.
				return '#' +
					twoDigitHex(red) +
					twoDigitHex(green) +
					twoDigitHex(blue);
			} else if (colorIndex >= 232 && colorIndex <= 255) {
				// Calculate the grayscale value.
				const rgb = Math.round((colorIndex - 232) / 23 * 255);
				const grayscale = twoDigitHex(rgb);

				// Return the RGB color.
				return '#' + grayscale + grayscale + grayscale;
			} else {
				// Wonky!
				return undefined;
			}
	}
};

/**
 * Makes a CUB (Cursor Backward) escape sequence.
 * @param count The count.
 * @returns The CUB escape sequence.
 */
/// <reference types="vitest/globals" />
const makeCUB = (count?: number) => {
	if (count === undefined) {
		return `${CSI()}D`;
	} else {
		return `${CSI()}${count}D`;
	}
};

/**
 * Makes a CUD (Cursor Down) escape sequence.
 * @param count The count.
 * @returns The CUD escape sequence.
 */
/// <reference types="vitest/globals" />
const makeCUD = (count?: number) => {
	if (count === undefined) {
		return `${CSI()}B`;
	} else {
		return `${CSI()}${count}B`;
	}
};

/**
 * Makes a CUF (Cursor Forward) escape sequence.
 * @param count The count.
 * @returns The CUF escape sequence.
 */
/// <reference types="vitest/globals" />
const makeCUF = (count?: number) => {
	if (count === undefined) {
		return `${CSI()}C`;
	} else {
		return `${CSI()}${count}C`;
	}
};

/**
 * Makes a CUP (Cursor Position) escape sequence.
 * @param line The line.
 * @param column The column.
 * @returns The CUP escape sequence.
 */
/// <reference types="vitest/globals" />
const makeCUP = (line?: number, column?: number) => {
	if (line === undefined && column === undefined) {
		return `${CSI()}H`;
	} else if (line !== undefined && column === undefined) {
		return `${CSI()}${line}H`;
	} else if (line === undefined && column !== undefined) {
		return `${CSI()};${column}H`;
	} else {
		return `${CSI()}${line};${column}H`;
	}
};

/**
 * Makes a CUU (Cursor Up) escape sequence.
 * @param count The count.
 * @returns The CUU escape sequence.
 */
/// <reference types="vitest/globals" />
const makeCUU = (count?: number) => {
	if (count === undefined) {
		return `${CSI()}A`;
	} else {
		return `${CSI()}${count}A`;
	}
};

/**
 * Makes an ED (Erase in Display) escape sequence.
 * @param direction The direction.
 * @returns The ED escape sequence.
 */
/// <reference types="vitest/globals" />
const makeED = (direction: 'end-of-screen' | 'end-of-screen-explicit-0' | 'beginning-of-screen' | 'entire-screen' = 'end-of-screen') => {
	switch (direction) {
		case 'end-of-screen':
			return `${CSI()}J`;

		case 'end-of-screen-explicit-0':
			return `${CSI()}0J`;

		case 'beginning-of-screen':
			return `${CSI()}1J`;

		case 'entire-screen':
			return `${CSI()}2J`;
	}
};

/**
 * Makes an EL (Erase in Line) escape sequence.
 * @param count The count.
 * @returns The EL escape sequence.
 */
/// <reference types="vitest/globals" />
const makeEL = (direction: 'end-of-line' | 'end-of-line-explicit-0' | 'beginning-of-line' | 'entire-line' = 'end-of-line') => {
	switch (direction) {
		case 'end-of-line':
			return `${CSI()}K`;

		case 'end-of-line-explicit-0':
			return `${CSI()}0K`;

		case 'beginning-of-line':
			return `${CSI()}1K`;

		case 'entire-line':
			return `${CSI()}2K`;
	}
};

/**
 * Makes an SGR (Select Graphic Rendition) escape sequence from standard SGR parameters.
 * @param parameters The SGR parameters.
 * @returns The SGR escape sequence.
 */
/// <reference types="vitest/globals" />
const makeSGR = (...parameters: SGRParam[]) => {
	return CSI() + parameters.map(parameter => `${parameter}`).join(';') + 'm';
};

/**
 * Makes an OSC 8 (Anchor) escape sequence.
 * @param text The text.
 * @param url The URL.
 * @param params The parameters (e.g. foo=bar:bar=foo).
 * @returns The SGR escape sequence.
 */
/// <reference types="vitest/globals" />
const makeOSC8 = (text: string, url: string, params: string = '') => {
	return `${OSC()}8;${params};${url}${ST()}${text}${OSC()}8;;${ST()}`;
};

/**
 * Sets up an ANSIOutput with a standard "screen" of content.
 * @returns The newly set up ANSIOutput.
 */
/// <reference types="vitest/globals" />
const setupStandardScreen = () => {
	const ansiOutput = new ANSIOutput();
	for (let i = 0; i < 25; i++) {
		ansiOutput.processOutput('0'.repeat(80));
		if (i < 24) {
			ansiOutput.processOutput(CRLF);
		}
	}

	return ansiOutput;
};

/**
 * Makes an array of lines.
 * @param count The number of lines to put in the array.
 * @returns The array of lines.
 */
/// <reference types="vitest/globals" />
const makeLines = (count: number): string[] => {
	// Make the lines.
	const lines: string[] = [];
	for (let i = 0; i < count; i++) {
		lines.push('0'.repeat(Math.floor(Math.random() * 1024) + (i === count - 1 ? 1 : 0)));
	}

	// Done.
	return lines;
};

/**
 * Converts a number to a two-digit hex string representing the value.
 * @param value The value.
 * @returns A two digit hex string representing the value.
 */
/// <reference types="vitest/globals" />
export const twoDigitHex = (value: number) => {
	// Sanity check the value.
	if (value < 0) {
		return '00';
	} else if (value > 255) {
		return 'ff';
	}

	// Return the value in hex format.
	const hex = value.toString(16);
	return hex.length === 2 ? hex : '0' + hex;
};

//#endregion Test Helpers

//#region Test Suite

/**
 * ANSIOutput suite.
 */
/// <reference types="vitest/globals" />
describe('ANSIOutput', () => {
	it('Test ANSIOutput.processOutput with empty string', () => {
		// Setup.
		const outputLines = ANSIOutput.processOutput('');

		// Tests.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns.length).toBe(0);
	});

	it('Test ANSIOutput.processOutput with PANGRAM', () => {
		// Setup.
		const outputLines = ANSIOutput.processOutput(PANGRAM);

		// Tests.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);
	});

	it('Test ANSIOutput with no output', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		const outputLines = ansiOutput.outputLines;

		// Tests.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(0);
	});

	it('Test ANSIOutput BS "[BS]"', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(BS);
		const outputLines = ansiOutput.outputLines;

		// Test
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(0);
	});

	it('Test ANSIOutput BS "[BS][BS][BS][BS][BS][BS][BS][BS][BS][BS]"', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(BS.repeat(10));
		const outputLines = ansiOutput.outputLines;

		// Test
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(0);
	});

	it('Test ANSIOutput BS "Hello X[BS]World"', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`Hello X${BS}World`);
		const outputLines = ansiOutput.outputLines;

		// Test
		const expectedOutput = 'Hello World';
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(expectedOutput);
	});

	it('Test ANSIOutput BS "Hello XXXX[BS][BS][BS][BS]World"', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`Hello XXXX${BS.repeat(4)}World`);
		const outputLines = ansiOutput.outputLines;

		// Test
		const expectedOutput = 'Hello World';
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(expectedOutput);
	});

	it('Test ANSIOutput BS "HelloXXXXX[BS][BS][BS][BS][BS] World"', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`HelloXXXXX${BS.repeat(5)} World`);
		const outputLines = ansiOutput.outputLines;

		// Test
		const expectedOutput = 'Hello World';
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(expectedOutput);
	});

	it('Test ANSIOutput BS "HelloXXXXX[BS][BS][BS][BS][BS][BS][BS][BS][BS][BS] World"', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`HelloXXXXX${BS.repeat(10)}Hello World`);
		const outputLines = ansiOutput.outputLines;

		// Test
		const expectedOutput = 'Hello World';
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(expectedOutput);
	});

	it('Test ANSIOutput BS RED GREEN BLUE becomes RED BLUE', () => {
		// Setup.
		const testText = 'This is some text for testing purposes';
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundRed)}${testText}${makeSGR(SGRParam.ForegroundGreen)}${testText}${makeSGR(SGRParam.ForegroundBlue)}${BS.repeat(testText.length)}${testText}${makeSGR()}`);
		const outputLines = ansiOutput.outputLines;

		// Test
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(2);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(ANSIColor.Red);
		expect(outputLines[0].outputRuns[0].text).toBe(testText);
		expect(outputLines[0].outputRuns[1].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[1].format!.foregroundColor).toBe(ANSIColor.Blue);
		expect(outputLines[0].outputRuns[1].text).toBe(testText);
	});

	it('Test ANSIOutput BS RED GREEN BLUE becomes BLUE GREEN', () => {
		// Setup.
		const testText = 'This is some text for testing purposes';
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundRed)}${testText}${makeSGR(SGRParam.ForegroundGreen)}${testText}${makeSGR(SGRParam.ForegroundBlue)}${BS.repeat(testText.length * 2)}${testText}${makeSGR()}`);
		const outputLines = ansiOutput.outputLines;

		// Test
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(2);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(ANSIColor.Blue);
		expect(outputLines[0].outputRuns[0].text).toBe(testText);
		expect(outputLines[0].outputRuns[1].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[1].format!.foregroundColor).toBe(ANSIColor.Green);
		expect(outputLines[0].outputRuns[1].text).toBe(testText);
	});

	it('Test ANSIOutput with PANGRAM', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(PANGRAM);
		const outputLines = ansiOutput.outputLines;

		// Tests.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);
	});

	it('Test ANSIOutput with two lines separated by LF', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${PANGRAM}${LF}${PANGRAM}`);
		const outputLines = ansiOutput.outputLines;

		// Test
		expect(outputLines.length).toBe(2);
		for (let i = 0; i < outputLines.length; i++) {
			expect(outputLines[i].outputRuns.length).toBe(1);
			expect(outputLines[i].outputRuns[0].id.length >= 1).toBeTruthy();
			expect(outputLines[i].outputRuns[0].format).toBe(undefined);
			expect(outputLines[i].outputRuns[0].text).toBe(PANGRAM);
		}
	});

	it('Test ANSIOutput with two lines separated by CRLF', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${PANGRAM}${CRLF}${PANGRAM}`);
		const outputLines = ansiOutput.outputLines;

		// Test
		expect(outputLines.length).toBe(2);
		for (let i = 0; i < outputLines.length; i++) {
			expect(outputLines[i].outputRuns.length).toBe(1);
			expect(outputLines[i].outputRuns[0].id.length >= 1).toBeTruthy();
			expect(outputLines[i].outputRuns[0].format).toBe(undefined);
			expect(outputLines[i].outputRuns[0].text).toBe(PANGRAM);
		}
	});

	it('Test ANSIOutput with 10 lines separated by LF and CRLF', () => {
		testOutputLines(10, LF);
		testOutputLines(10, CRLF);
	});

	it('Test ANSIOutput with 100 lines separated by LF and CRLF', () => {
		testOutputLines(100, LF);
		testOutputLines(100, CRLF);
	});

	it('Test ANSIOutput with 2,500 output lines separated by LF and CRLF', () => {
		testOutputLines(2500, LF);
		testOutputLines(2500, CRLF);
	});

	it('Test ANSIOutput with 10,000 output lines separated by LF and CRLF', () => {
		testOutputLines(10000, LF);
		testOutputLines(10000, CRLF);
	});

	it('Text that exactly overwriting output runs to the right works', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundRed)}0123456789${makeSGR()}`);
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundBlue)}0123456789${makeSGR()}`);
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundGreen)}0123456789${makeSGR()}`);
		ansiOutput.processOutput(CR);
		ansiOutput.processOutput("                              ");
		ansiOutput.processOutput(CR);
		ansiOutput.processOutput("0123456789");
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('0123456789                    ');
	});

	it('Text that over overwriting output runs to the right works', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundRed)}0123456789${makeSGR()}`);
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundBlue)}0123456789${makeSGR()}`);
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundGreen)}0123456789${makeSGR()}`);
		ansiOutput.processOutput(CR);
		ansiOutput.processOutput("                                        ");
		ansiOutput.processOutput(CR);
		ansiOutput.processOutput("0123456789");
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('0123456789                              ');
	});

	it('Test CUB (Cursor Backward)', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));

		// Test.
		ansiOutput.processOutput(makeCUB());
		checkOutputPosition(ansiOutput, 0, 79);
		ansiOutput.processOutput(makeCUB(1));
		checkOutputPosition(ansiOutput, 0, 78);
		ansiOutput.processOutput(makeCUB(10));
		checkOutputPosition(ansiOutput, 0, 68);
		ansiOutput.processOutput(makeCUB(100));
		checkOutputPosition(ansiOutput, 0, 0);
	});

	it('Test CUB (Cursor Backward) to start of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput('XXXXXXXXXX');
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('XXXXXXXXXX0000000000000000000000000000000000000000000000000000000000000000000000');
	});

	it('Test CUB (Cursor Backward) to middle of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(makeCUB(45));
		ansiOutput.processOutput('XXXXXXXXXX');
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('00000000000000000000000000000000000XXXXXXXXXX00000000000000000000000000000000000');
	});

	it('Test CUB (Cursor Backward) to end of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(makeCUB(10));
		ansiOutput.processOutput('XXXXXXXXXX');
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('0000000000000000000000000000000000000000000000000000000000000000000000XXXXXXXXXX');
	});

	it('Test CUD (Cursor Down)', () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP());

		// Test.
		ansiOutput.processOutput(makeCUD());
		checkOutputPosition(ansiOutput, 1, 0);
		ansiOutput.processOutput(makeCUD(1));
		checkOutputPosition(ansiOutput, 2, 0);
		ansiOutput.processOutput(makeCUD(10));
		checkOutputPosition(ansiOutput, 12, 0);
		ansiOutput.processOutput(makeCUD(100));
		checkOutputPosition(ansiOutput, 112, 0);
	});

	it('Test CUF (Cursor Forward)', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUP());

		// Test.
		ansiOutput.processOutput(makeCUF());
		checkOutputPosition(ansiOutput, 0, 1);
		ansiOutput.processOutput(makeCUF(1));
		checkOutputPosition(ansiOutput, 0, 2);
		ansiOutput.processOutput(makeCUF(10));
		checkOutputPosition(ansiOutput, 0, 12);
		ansiOutput.processOutput(makeCUF(100));
		checkOutputPosition(ansiOutput, 0, 112);
	});

	it('Test CUF (Cursor Forward) to start of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput(makeCUF());
		ansiOutput.processOutput('XXXXXXXXXX');
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('0XXXXXXXXXX000000000000000000000000000000000000000000000000000000000000000000000');
	});

	it('Test CUF (Cursor Forward) to middle of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput(makeCUF(35));
		ansiOutput.processOutput('XXXXXXXXXX');
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('00000000000000000000000000000000000XXXXXXXXXX00000000000000000000000000000000000');
	});

	it('Test CUF (Cursor Forward) to end of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput(makeCUF(70));
		ansiOutput.processOutput('XXXXXXXXXX');
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('0000000000000000000000000000000000000000000000000000000000000000000000XXXXXXXXXX');
	});

	it("Tests CUP (Cursor Position)", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();

		// Test.
		ansiOutput.processOutput(makeCUP());
		checkOutputPosition(ansiOutput, 0, 0);
		ansiOutput.processOutput(makeCUP(10, 10));
		checkOutputPosition(ansiOutput, 9, 9);
		ansiOutput.processOutput(makeCUP(100, 100));
		checkOutputPosition(ansiOutput, 99, 99);
		ansiOutput.processOutput(makeCUP(8192, 8192));
		checkOutputPosition(ansiOutput, 8191, 8191);
	});

	it("Tests CUU (Cursor Up)", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();

		// Test.
		ansiOutput.processOutput(makeCUU());
		checkOutputPosition(ansiOutput, 23, 80);
		ansiOutput.processOutput(makeCUU(1));
		checkOutputPosition(ansiOutput, 22, 80);
		ansiOutput.processOutput(makeCUU(10));
		checkOutputPosition(ansiOutput, 12, 80);
		ansiOutput.processOutput(makeCUU(20));
		checkOutputPosition(ansiOutput, 0, 80);
	});

	it('Tests end of screen ED using implicit 0', () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP(13, 41));

		// Test.
		ansiOutput.processOutput(makeED('end-of-screen'));
		const zeros = '0'.repeat(80);
		for (let i = 0; i < 12; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(zeros);
		}
		expect(ansiOutput.outputLines[12].outputRuns.length).toBe(2);
		expect(ansiOutput.outputLines[12].outputRuns[0].text).toBe('0000000000000000000000000000000000000000');
		expect(ansiOutput.outputLines[12].outputRuns[1].text).toBe('                                        ');
		const spaces = ' '.repeat(80);
		for (let i = 13; i < 24; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(spaces);
		}
	});

	it('Tests end of screen ED using explicit 0', () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP(13, 41));

		// Test.
		checkOutputPosition(ansiOutput, 12, 40);
		ansiOutput.processOutput(makeED('end-of-screen-explicit-0'));
		const zeros = '0'.repeat(80);
		for (let i = 0; i < 12; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(zeros);
		}
		expect(ansiOutput.outputLines[12].outputRuns.length).toBe(2);
		expect(ansiOutput.outputLines[12].outputRuns[0].text).toBe('0000000000000000000000000000000000000000');
		expect(ansiOutput.outputLines[12].outputRuns[1].text).toBe('                                        ');
		const spaces = ' '.repeat(80);
		for (let i = 13; i < 24; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(spaces);
		}
	});

	it('Tests ED 1', () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP(13, 41));

		// Test.
		checkOutputPosition(ansiOutput, 12, 40);
		ansiOutput.processOutput(makeED('beginning-of-screen'));
		const spaces = ' '.repeat(80);
		for (let i = 0; i < 12; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(spaces);
		}
		expect(ansiOutput.outputLines[12].outputRuns.length).toBe(2);
		expect(ansiOutput.outputLines[12].outputRuns[0].text).toBe('                                        ');
		expect(ansiOutput.outputLines[12].outputRuns[1].text).toBe('0000000000000000000000000000000000000000');
		const zeros = '0'.repeat(80);
		for (let i = 13; i < 24; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(zeros);
		}
	});

	it('Tests ED 2 from the bottom', () => {
		// Setup.
		const ansiOutput = setupStandardScreen();

		// Test.
		ansiOutput.processOutput(makeED('entire-screen'));
		checkOutputPosition(ansiOutput, 24, 80);
		expect(ansiOutput.outputLines.length).toBe(25);
		const spaces = ' '.repeat(80);
		for (let i = 0; i < 25; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(spaces);
		}
	});

	it('Tests ED 2 from the top', () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP());

		// Test.
		ansiOutput.processOutput(makeED('entire-screen'));
		checkOutputPosition(ansiOutput, 0, 0);
		expect(ansiOutput.outputLines.length).toBe(25);
		const spaces = ' '.repeat(80);
		for (let i = 0; i < 25; i++) {
			expect(ansiOutput.outputLines[i].outputRuns.length).toBe(1);
			expect(ansiOutput.outputLines[i].outputRuns[0].text).toBe(spaces);
		}
	});

	it("Tests EL 0 when there is nothing to clear", () => {
		// Setup.
		const ansiOutput = new ANSIOutput();

		// Test.
		ansiOutput.processOutput(makeEL("end-of-line"));
		expect(ansiOutput.outputLines[0].outputRuns.length).toBe(0);
	});

	it('Tests EL 0 using implicit 0', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(CR);

		// Test.
		ansiOutput.processOutput(makeEL('end-of-line'));
		expect(ansiOutput.outputLines[0].outputRuns.length).toBe(1);
		expect(ansiOutput.outputLines[0].outputRuns[0].text).toBe(' '.repeat(80));
	});

	it('Tests EL 0 using explicit 0', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(CR);

		// Test.
		ansiOutput.processOutput(makeEL('end-of-line-explicit-0'));
		expect(ansiOutput.outputLines[0].outputRuns.length).toBe(1);
		expect(ansiOutput.outputLines[0].outputRuns[0].text).toBe(' '.repeat(80));
	});

	it('Tests EL 1', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));

		// Test.
		ansiOutput.processOutput(makeEL('beginning-of-line'));
		expect(ansiOutput.outputLines[0].outputRuns.length).toBe(1);
		expect(ansiOutput.outputLines[0].outputRuns[0].text).toBe(' '.repeat(80));
	});

	it('Tests EL 2', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput('0'.repeat(80));
		ansiOutput.processOutput(makeCUP(1, 41));

		// Test.
		ansiOutput.processOutput(makeEL('entire-line'));
		expect(ansiOutput.outputLines[0].outputRuns.length).toBe(1);
		expect(ansiOutput.outputLines[0].outputRuns[0].text).toBe(' '.repeat(80));
	});

	it('Tests foreground colors with no background colors', () => {
		// Create the test scenarios.
		const testScenarios: SGRTestScenario[] = [
			{
				sgr: [
					SGRParam.ForegroundBlack
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black
				}
			},
			{
				sgr: [
					SGRParam.ForegroundRed
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Red
				}
			},
			{
				sgr: [
					SGRParam.ForegroundGreen
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Green
				}
			},
			{
				sgr: [
					SGRParam.ForegroundYellow
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Yellow
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBlue
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Blue
				}
			},
			{
				sgr: [
					SGRParam.ForegroundMagenta
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Magenta
				}
			},
			{
				sgr: [
					SGRParam.ForegroundCyan
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Cyan
				}
			},
			{
				sgr: [
					SGRParam.ForegroundWhite
				],
				ansiFormat: {
					foregroundColor: ANSIColor.White
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightBlack
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightBlack
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightRed
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightRed
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightGreen
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightGreen
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightYellow
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightYellow
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightBlue
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightBlue
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightMagenta
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightMagenta
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightCyan
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightCyan
				}
			},
			{
				sgr: [
					SGRParam.ForegroundBrightWhite
				],
				ansiFormat: {
					foregroundColor: ANSIColor.BrightWhite
				}
			}
		];

		// Run the test scenarios.
		for (const testScenario of testScenarios) {
			// Setup.
			const ansiOutput = new ANSIOutput();
			ansiOutput.processOutput(`${makeSGR(...testScenario.sgr)}${PANGRAM}${makeSGR()}`);
			const outputLines = ansiOutput.outputLines;

			// Tests that there's one output line and one output run in it.
			expect(outputLines.length).toBe(1);
			expect(outputLines[0].outputRuns.length).toBe(1);

			// Test that the output run text is correct.
			expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

			// Test that the output format is correct.
			expect(outputLines[0].outputRuns[0].format).not.toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.styles).toBe(testScenario.ansiFormat.styles);
			expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(testScenario.ansiFormat.foregroundColor);
			expect(outputLines[0].outputRuns[0].format!.backgroundColor).toBe(testScenario.ansiFormat.backgroundColor);
			expect(outputLines[0].outputRuns[0].format!.underlinedColor).toBe(testScenario.ansiFormat.underlinedColor);
			expect(outputLines[0].outputRuns[0].format!.font).toBe(testScenario.ansiFormat.font);
		}
	});

	it('Tests background colors and automatically contrasting foreground colors', () => {
		// Create the test scenarios.
		const testScenarios: SGRTestScenario[] = [
			{
				sgr: [
					SGRParam.BackgroundBlack
				],
				ansiFormat: {
					foregroundColor: ANSIColor.White,
					backgroundColor: ANSIColor.Black
				}
			},
			{
				sgr: [
					SGRParam.BackgroundRed
				],
				ansiFormat: {
					foregroundColor: ANSIColor.White,
					backgroundColor: ANSIColor.Red
				}
			},
			{
				sgr: [
					SGRParam.BackgroundGreen
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.Green
				}
			},
			{
				sgr: [
					SGRParam.BackgroundYellow
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.Yellow
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBlue
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.Blue
				}
			},
			{
				sgr: [
					SGRParam.BackgroundMagenta
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.Magenta
				}
			},
			{
				sgr: [
					SGRParam.BackgroundCyan
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.Cyan
				}
			},
			{
				sgr: [
					SGRParam.BackgroundWhite
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.White
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightBlack
				],
				ansiFormat: {
					foregroundColor: ANSIColor.White,
					backgroundColor: ANSIColor.BrightBlack
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightRed
				],
				ansiFormat: {
					foregroundColor: ANSIColor.White,
					backgroundColor: ANSIColor.BrightRed
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightGreen
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.BrightGreen
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightYellow
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.BrightYellow
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightBlue
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.BrightBlue
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightMagenta
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.BrightMagenta
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightCyan
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.BrightCyan
				}
			},
			{
				sgr: [
					SGRParam.BackgroundBrightWhite
				],
				ansiFormat: {
					foregroundColor: ANSIColor.Black,
					backgroundColor: ANSIColor.BrightWhite
				}
			}
		];

		// Run the test scenarios.
		for (const testScenario of testScenarios) {
			// Setup.
			const ansiOutput = new ANSIOutput();
			ansiOutput.processOutput(`${makeSGR(...testScenario.sgr)}${PANGRAM}${makeSGR()}`);
			const outputLines = ansiOutput.outputLines;

			// Tests that there's one output line and one output run in it.
			expect(outputLines.length).toBe(1);
			expect(outputLines[0].outputRuns.length).toBe(1);

			// Test that the output run text is correct.
			expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

			// Test that the output format is correct.
			expect(outputLines[0].outputRuns[0].format).not.toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.styles).toBe(testScenario.ansiFormat.styles);
			expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(testScenario.ansiFormat.foregroundColor);
			expect(outputLines[0].outputRuns[0].format!.backgroundColor).toBe(testScenario.ansiFormat.backgroundColor);
			expect(outputLines[0].outputRuns[0].format!.underlinedColor).toBe(testScenario.ansiFormat.underlinedColor);
			expect(outputLines[0].outputRuns[0].format!.font).toBe(testScenario.ansiFormat.font);
		}
	});

	it('Tests ANSI 16 matrix', () => {
		/**
		 * SGRToAnsiColorMap type.
		 */
		/// <reference types="vitest/globals" />
		type SGRToAnsiColorMap = [SGRParam, ANSIColor];

		// Foreground colors.
		const foregroundColors: SGRToAnsiColorMap[] = [
			[SGRParam.ForegroundBlack, ANSIColor.Black],
			[SGRParam.ForegroundRed, ANSIColor.Red],
			[SGRParam.ForegroundGreen, ANSIColor.Green],
			[SGRParam.ForegroundYellow, ANSIColor.Yellow],
			[SGRParam.ForegroundBlue, ANSIColor.Blue],
			[SGRParam.ForegroundMagenta, ANSIColor.Magenta],
			[SGRParam.ForegroundCyan, ANSIColor.Cyan],
			[SGRParam.ForegroundWhite, ANSIColor.White],
			[SGRParam.ForegroundBrightBlack, ANSIColor.BrightBlack],
			[SGRParam.ForegroundBrightRed, ANSIColor.BrightRed],
			[SGRParam.ForegroundBrightGreen, ANSIColor.BrightGreen],
			[SGRParam.ForegroundBrightYellow, ANSIColor.BrightYellow],
			[SGRParam.ForegroundBrightBlue, ANSIColor.BrightBlue],
			[SGRParam.ForegroundBrightMagenta, ANSIColor.BrightMagenta],
			[SGRParam.ForegroundBrightCyan, ANSIColor.BrightCyan],
			[SGRParam.ForegroundBrightWhite, ANSIColor.BrightWhite]
		];

		// Background colors.
		const backgroundColors: SGRToAnsiColorMap[] = [
			[SGRParam.BackgroundBlack, ANSIColor.Black],
			[SGRParam.BackgroundRed, ANSIColor.Red],
			[SGRParam.BackgroundGreen, ANSIColor.Green],
			[SGRParam.BackgroundYellow, ANSIColor.Yellow],
			[SGRParam.BackgroundBlue, ANSIColor.Blue],
			[SGRParam.BackgroundMagenta, ANSIColor.Magenta],
			[SGRParam.BackgroundCyan, ANSIColor.Cyan],
			[SGRParam.BackgroundWhite, ANSIColor.White],
			[SGRParam.BackgroundBrightBlack, ANSIColor.BrightBlack],
			[SGRParam.BackgroundBrightRed, ANSIColor.BrightRed],
			[SGRParam.BackgroundBrightGreen, ANSIColor.BrightGreen],
			[SGRParam.BackgroundBrightYellow, ANSIColor.BrightYellow],
			[SGRParam.BackgroundBrightBlue, ANSIColor.BrightBlue],
			[SGRParam.BackgroundBrightMagenta, ANSIColor.BrightMagenta],
			[SGRParam.BackgroundBrightCyan, ANSIColor.BrightCyan],
			[SGRParam.BackgroundBrightWhite, ANSIColor.BrightWhite]
		];

		// Construct the test scenarios.
		const testScenarios: SGRTestScenario[] = [];
		for (const foregroundColor of foregroundColors) {
			for (const backgroundColor of backgroundColors) {
				testScenarios.push({
					sgr: [foregroundColor[0], backgroundColor[0]],
					ansiFormat: {
						foregroundColor: foregroundColor[1],
						backgroundColor: backgroundColor[1]
					}
				});
			}
		}

		// Run the test scenarios.
		for (const testScenario of testScenarios) {
			// Setup.
			const ansiOutput = new ANSIOutput();
			ansiOutput.processOutput(`${makeSGR(...testScenario.sgr)}${PANGRAM}${makeSGR()}`);
			const outputLines = ansiOutput.outputLines;

			// Tests that there's one output line and one output run in it.
			expect(outputLines.length).toBe(1);
			expect(outputLines[0].outputRuns.length).toBe(1);

			// Test that the output run text is correct.
			expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

			// Test that the output format is correct.
			expect(outputLines[0].outputRuns[0].format).not.toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.styles).toBe(testScenario.ansiFormat.styles);
			expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(testScenario.ansiFormat.foregroundColor);
			expect(outputLines[0].outputRuns[0].format!.backgroundColor).toBe(testScenario.ansiFormat.backgroundColor);
			expect(outputLines[0].outputRuns[0].format!.underlinedColor).toBe(testScenario.ansiFormat.underlinedColor);
			expect(outputLines[0].outputRuns[0].format!.font).toBe(testScenario.ansiFormat.font);
		}
	});

	it('Tests ANSI 256 matrix', { timeout: 30_000 }, () => {
		const testScenarios: SGRTestScenario[] = [];
		for (let foregroundIndex = 0; foregroundIndex < 256; foregroundIndex++) {
			for (let backgroundIndex = 0; backgroundIndex < 256; backgroundIndex++) {
				testScenarios.push({
					sgr: [
						SGRParam.SetForeground,
						SGRParamColor.Color256,
						foregroundIndex,
						SGRParam.SetBackground,
						SGRParamColor.Color256,
						backgroundIndex
					],
					ansiFormat: {
						foregroundColor: map8BitColorIndexToColor(foregroundIndex),
						backgroundColor: map8BitColorIndexToColor(backgroundIndex)
					}
				});
			}
		}

		// Run the test scenarios.
		for (const testScenario of testScenarios) {
			// Setup.
			const ansiOutput = new ANSIOutput();
			ansiOutput.processOutput(`${makeSGR(...testScenario.sgr)}${PANGRAM}${makeSGR()}`);
			const outputLines = ansiOutput.outputLines;

			// Tests that there's one output line and one output run in it.
			expect(outputLines.length).toBe(1);
			expect(outputLines[0].outputRuns.length).toBe(1);

			// Test that the output run text is correct.
			expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

			// Test that the output format is correct.
			expect(outputLines[0].outputRuns[0].format).not.toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.styles).toBe(testScenario.ansiFormat.styles);
			expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(testScenario.ansiFormat.foregroundColor);
			expect(outputLines[0].outputRuns[0].format!.backgroundColor).toBe(testScenario.ansiFormat.backgroundColor);
			expect(outputLines[0].outputRuns[0].format!.underlinedColor).toBe(testScenario.ansiFormat.underlinedColor);
			expect(outputLines[0].outputRuns[0].format!.font).toBe(testScenario.ansiFormat.font);
		}
	});

	it('Tests ANSI RGB matrix', { timeout: 30_000 }, () => {
		const testScenarios: SGRTestScenario[] = [];
		for (let r = 0; r < 256; r++) {
			for (let g = 0; g < 256; g++) {
				testScenarios.push({
					sgr: [
						SGRParam.SetForeground,
						SGRParamColor.ColorRGB,
						r,
						g,
						128,
						SGRParam.SetBackground,
						SGRParamColor.ColorRGB,
						r,
						g,
						128,
					],
					ansiFormat: {
						foregroundColor: `#${twoDigitHex(r)}${twoDigitHex(g)}${twoDigitHex(128)}`,
						backgroundColor: `#${twoDigitHex(r)}${twoDigitHex(g)}${twoDigitHex(128)}`
					}
				});
			}
		}

		// Run the test scenarios.
		for (const testScenario of testScenarios) {
			// Setup.
			const ansiOutput = new ANSIOutput();
			ansiOutput.processOutput(`${makeSGR(...testScenario.sgr)}${PANGRAM}${makeSGR()}`);
			const outputLines = ansiOutput.outputLines;

			// Tests that there's one output line and one output run in it.
			expect(outputLines.length).toBe(1);
			expect(outputLines[0].outputRuns.length).toBe(1);

			// Test that the output run text is correct.
			expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

			// Test that the output format is correct.
			expect(outputLines[0].outputRuns[0].format).not.toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.styles).toBe(testScenario.ansiFormat.styles);
			expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(testScenario.ansiFormat.foregroundColor);
			expect(outputLines[0].outputRuns[0].format!.backgroundColor).toBe(testScenario.ansiFormat.backgroundColor);
			expect(outputLines[0].outputRuns[0].format!.underlinedColor).toBe(testScenario.ansiFormat.underlinedColor);
			expect(outputLines[0].outputRuns[0].format!.font).toBe(testScenario.ansiFormat.font);
		}
	});

	it('Tests insertion of blue text into an output run of red text', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		// Create a red output run.
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundRed)}${'0'.repeat(80)}${makeSGR()}`);
		// Insert a blue output in the middle of the red output run.
		ansiOutput.processOutput(makeCUB(45));
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundBlue)}XXXXXXXXXX${makeSGR()}`);
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].outputRuns.length).toBe(3);

		// First red segment.
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).not.toBe(undefined);
		expect(outputLines[0].outputRuns[0].format!.styles).toBe(undefined);
		expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(ANSIColor.Red);
		expect(outputLines[0].outputRuns[0].format!.backgroundColor).toBe(undefined);
		expect(outputLines[0].outputRuns[0].format!.underlinedColor).toBe(undefined);
		expect(outputLines[0].outputRuns[0].format!.font).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe('00000000000000000000000000000000000');

		// Inserted blue segment.
		expect(outputLines[0].outputRuns[1].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[1].format).not.toBe(undefined);
		expect(outputLines[0].outputRuns[1].format!.styles).toBe(undefined);
		expect(outputLines[0].outputRuns[1].format!.foregroundColor).toBe(ANSIColor.Blue);
		expect(outputLines[0].outputRuns[1].format!.backgroundColor).toBe(undefined);
		expect(outputLines[0].outputRuns[1].format!.underlinedColor).toBe(undefined);
		expect(outputLines[0].outputRuns[1].format!.font).toBe(undefined);
		expect(outputLines[0].outputRuns[1].text).toBe('XXXXXXXXXX');

		// Second red segment.
		expect(outputLines[0].outputRuns[2].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[2].format).not.toBe(undefined);
		expect(outputLines[0].outputRuns[2].format!.styles).toBe(undefined);
		expect(outputLines[0].outputRuns[2].format!.foregroundColor).toBe(ANSIColor.Red);
		expect(outputLines[0].outputRuns[2].format!.backgroundColor).toBe(undefined);
		expect(outputLines[0].outputRuns[2].format!.underlinedColor).toBe(undefined);
		expect(outputLines[0].outputRuns[2].format!.font).toBe(undefined);
		expect(outputLines[0].outputRuns[2].text).toBe('00000000000000000000000000000000000');
	});

	it("Tests styles", () => {
		const testStyle = (sgr: SGRParam, ansiStyle: ANSIStyle) => {
			// Setup.
			const ansiOutput = new ANSIOutput();
			ansiOutput.processOutput(`${makeSGR(sgr)}${'0'.repeat(80)}${makeSGR()}`);
			const outputLines = ansiOutput.outputLines;
			expect(outputLines.length).toBe(1);
			expect(outputLines[0].outputRuns.length).toBe(1);
			expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
			expect(outputLines[0].outputRuns[0].format).not.toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.styles!.length).toBe(1);
			expect(outputLines[0].outputRuns[0].format!.styles![0]).toBe(ansiStyle);
			expect(outputLines[0].outputRuns[0].format!.foregroundColor).toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.backgroundColor).toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.underlinedColor).toBe(undefined);
			expect(outputLines[0].outputRuns[0].format!.font).toBe(undefined);
			expect(outputLines[0].outputRuns[0].text).toBe('0'.repeat(80));
		};

		testStyle(SGRParam.Bold, ANSIStyle.Bold);
		testStyle(SGRParam.Dim, ANSIStyle.Dim);
		testStyle(SGRParam.Italic, ANSIStyle.Italic);
		testStyle(SGRParam.Underlined, ANSIStyle.Underlined);
		testStyle(SGRParam.SlowBlink, ANSIStyle.SlowBlink);
		testStyle(SGRParam.RapidBlink, ANSIStyle.RapidBlink);
		testStyle(SGRParam.Hidden, ANSIStyle.Hidden);
		testStyle(SGRParam.CrossedOut, ANSIStyle.CrossedOut);
		testStyle(SGRParam.Fraktur, ANSIStyle.Fraktur);
		testStyle(SGRParam.DoubleUnderlined, ANSIStyle.DoubleUnderlined);
		// These styles are not implemented yet.
		// testStyle(SGRParam.Framed, ANSIStyle.Framed);
		// testStyle(SGRParam.Encircled, ANSIStyle.Encircled);
		// testStyle(SGRParam.Overlined, ANSIStyle.Overlined);
		// testStyle(SGRParam.Superscript, ANSIStyle.Superscript);
		// testStyle(SGRParam.Subscript, ANSIStyle.Subscript);
	});

	it('Tests OSC 8 scenario 1', () => {
		// Setup.
		const linkText = 'This is POSIT!!!';
		const linkURL = 'http://www.posit.co';
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(makeOSC8(linkText, linkURL));
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);
		expect(outputLines[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].hyperlink).not.toBe(undefined);
		expect(outputLines[0].outputRuns[0].hyperlink!.url).toBe(linkURL);
		expect(outputLines[0].outputRuns[0].hyperlink!.params).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(linkText);
	});

	it('Tests OSC 8 scenario 2', () => {
		// Setup.
		const linkText = 'This is POSIT!!!';
		const linkURL = 'http://www.posit.co';
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(PANGRAM);
		ansiOutput.processOutput(makeOSC8(linkText, linkURL));
		ansiOutput.processOutput(PANGRAM);
		// ansiOutput.processOutput(PANGRAM);
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(1);

		expect(outputLines[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns.length).toBe(3);

		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].hyperlink).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

		expect(outputLines[0].outputRuns[1].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[1].format).toBe(undefined);
		expect(outputLines[0].outputRuns[1].hyperlink).not.toBe(undefined);
		expect(outputLines[0].outputRuns[1].hyperlink!.url).toBe(linkURL);
		expect(outputLines[0].outputRuns[1].hyperlink!.params).toBe(undefined);
		expect(outputLines[0].outputRuns[1].text).toBe(linkText);

		expect(outputLines[0].outputRuns[2].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[2].format).toBe(undefined);
		expect(outputLines[0].outputRuns[2].hyperlink).toBe(undefined);
		expect(outputLines[0].outputRuns[2].text).toBe(PANGRAM);
	});

	it('Tests OSC 8 scenario 3', () => {
		// Setup.
		const linkText = 'This is POSIT!!!';
		const linkURL = 'http://www.posit.co';
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(PANGRAM + '\n');
		ansiOutput.processOutput(makeOSC8(`${linkText}\n${linkText}\n`, linkURL));
		ansiOutput.processOutput(PANGRAM);
		// ansiOutput.processOutput(PANGRAM);
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(4);

		expect(outputLines[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

		expect(outputLines[1].id.length >= 1).toBeTruthy();
		expect(outputLines[1].outputRuns.length).toBe(1);
		expect(outputLines[1].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[1].outputRuns[0].format).toBe(undefined);
		expect(outputLines[1].outputRuns[0].hyperlink).not.toBe(undefined);
		expect(outputLines[1].outputRuns[0].hyperlink!.url).toBe(linkURL);
		expect(outputLines[1].outputRuns[0].hyperlink!.params).toBe(undefined);
		expect(outputLines[1].outputRuns[0].text).toBe(linkText);

		expect(outputLines[2].id.length >= 1).toBeTruthy();
		expect(outputLines[2].outputRuns.length).toBe(1);
		expect(outputLines[2].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[2].outputRuns[0].format).toBe(undefined);
		expect(outputLines[2].outputRuns[0].hyperlink).not.toBe(undefined);
		expect(outputLines[2].outputRuns[0].hyperlink!.url).toBe(linkURL);
		expect(outputLines[1].outputRuns[0].hyperlink!.params).toBe(undefined);
		expect(outputLines[2].outputRuns[0].text).toBe(linkText);

		expect(outputLines[3].id.length >= 1).toBeTruthy();
		expect(outputLines[3].outputRuns.length).toBe(1);
		expect(outputLines[3].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[3].outputRuns[0].format).toBe(undefined);
		expect(outputLines[3].outputRuns[0].text).toBe(PANGRAM);
	});

	it('Tests OSC 8 scenario 4', () => {
		// Setup.
		const linkText = 'This is POSIT!!!';
		const linkURL = 'http://www.posit.co';
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(PANGRAM + '\n');
		ansiOutput.processOutput(makeOSC8(`${makeSGR(SGRParam.ForegroundRed)}${linkText}\n${linkText}${makeSGR()}\n`, linkURL));
		ansiOutput.processOutput(PANGRAM);
		// ansiOutput.processOutput(PANGRAM);
		const outputLines = ansiOutput.outputLines;

		// Test.
		expect(outputLines.length).toBe(4);

		expect(outputLines[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns.length).toBe(1);
		expect(outputLines[0].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[0].outputRuns[0].format).toBe(undefined);
		expect(outputLines[0].outputRuns[0].text).toBe(PANGRAM);

		expect(outputLines[1].id.length >= 1).toBeTruthy();
		expect(outputLines[1].outputRuns.length).toBe(1);
		expect(outputLines[1].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[1].outputRuns[0].format).not.toBe(undefined);
		expect(outputLines[1].outputRuns[0].format!.foregroundColor).toBe(ANSIColor.Red);
		expect(outputLines[1].outputRuns[0].hyperlink).not.toBe(undefined);
		expect(outputLines[1].outputRuns[0].hyperlink!.url).toBe(linkURL);
		expect(outputLines[1].outputRuns[0].hyperlink!.params).toBe(undefined);
		expect(outputLines[1].outputRuns[0].text).toBe(linkText);

		expect(outputLines[2].id.length >= 1).toBeTruthy();
		expect(outputLines[2].outputRuns.length).toBe(1);
		expect(outputLines[2].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[2].outputRuns[0].format).not.toBe(undefined);
		expect(outputLines[2].outputRuns[0].format!.foregroundColor).toBe(ANSIColor.Red);
		expect(outputLines[2].outputRuns[0].hyperlink).not.toBe(undefined);
		expect(outputLines[2].outputRuns[0].hyperlink!.url).toBe(linkURL);
		expect(outputLines[2].outputRuns[0].hyperlink!.params).toBe(undefined);
		expect(outputLines[2].outputRuns[0].text).toBe(linkText);

		expect(outputLines[3].id.length >= 1).toBeTruthy();
		expect(outputLines[3].outputRuns.length).toBe(1);
		expect(outputLines[3].outputRuns[0].id.length >= 1).toBeTruthy();
		expect(outputLines[3].outputRuns[0].format).toBe(undefined);
		expect(outputLines[3].outputRuns[0].text).toBe(PANGRAM);
	});

	const testOutputLines = (count: number, terminator: string) => {
		// Setup.
		const lines = makeLines(count);
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(lines.join(terminator));
		const outputLines = ansiOutput.outputLines;

		// Tests.
		expect(outputLines.length).toBe(lines.length);
		for (let i = 0; i < outputLines.length; i++) {
			if (!lines[i].length) {
				expect(outputLines[i].outputRuns.length).toBe(0);
			} else {
				expect(outputLines[i].id.length >= 1).toBeTruthy();
				expect(outputLines[i].outputRuns.length).toBe(1);
				expect(outputLines[i].outputRuns[0].text.length).toBe(lines[i].length);
			}
		}
	};

	/**
	 * Checks the output position for an ANSIOutput.
	 * @param ansiOutput The ANSIOutput to check the output position for.
	 * @param outputLine The expected output line.
	 * @param outputColumn The expected output column.
	 */
	/// <reference types="vitest/globals" />
	const checkOutputPosition = (ansiOutput: ANSIOutput, outputLine: number, outputColumn: number) => {
		expect(ansiOutput['_outputLine' as keyof ANSIOutput] as unknown as number).toBe(outputLine);
		expect(ansiOutput['_outputColumn' as keyof ANSIOutput] as unknown as number).toBe(outputColumn);
	};

});

//#endregion Test Suite
