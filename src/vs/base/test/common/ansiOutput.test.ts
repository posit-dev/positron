/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ANSIColor, ANSIFormat, ANSIOutput, ANSIStyle } from 'vs/base/common/ansiOutput';

//#region Test Helpers

/**
 * Constants.
 */
const CR = "\r";
const LF = "\n";
const CRLF = `${CR}${LF}`;
const ESC = '\x1b';
const CSI = ESC + '[';
const PANGRAM = "The quick brown fox jumps over the lazy dog";

/**
 * SGR (Select Graphic Rendition).
 */
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
enum SGRParamColor {
	Color256 = 5,
	ColorRGB = 2
}

/**
 * SGRValue type.
 */
type SGRValue = SGRParam | SGRParamColor | number;

/**
 * SGRTestScenario interface.
 */
interface SGRTestScenario {
	sgr: SGRValue[];
	ansiFormat: ANSIFormat;
}

/**
 * Maps an 8-bit color index to an ANSIColor or RGB color value.
 * @param colorIndex The 8-bit color index.
 * @returns An ANSIColor or RGB color value.
 */
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
 * Makes an array of lines.
 * @param count The number of lines to put in the array.
 * @returns The array of lines.
 */
const makeLines = (count: number): string[] => {
	// Make the lines.
	const lines: string[] = [];
	for (let i = 0; i < count; i++) {
		lines.push("0".repeat(Math.floor(Math.random() * 1025)));
	}

	// Done.
	return lines;
};

/**
 * Sets up an ANSIOutput with a standard "screen" of content.
 * @returns The newly set up ANSIOutput.
 */
const setupStandardScreen = () => {
	const ansiOutput = new ANSIOutput();
	for (let i = 0; i < 25; i++) {
		ansiOutput.processOutput("0".repeat(80));
		if (i < 24) {
			ansiOutput.processOutput(CRLF);
		}
	}

	return ansiOutput;
};

/**
 * Makes a CUB (Cursor Backward) escape sequence.
 * @param count The count.
 * @returns The CUB escape sequence.
 */
const makeCUB = (count?: number) => {
	if (count === undefined) {
		return `${CSI}D`;
	} else {
		return `${CSI}${count}D`;
	}
};

/**
 * Makes a CUD (Cursor Down) escape sequence.
 * @param count The count.
 * @returns The CUD escape sequence.
 */
const makeCUD = (count?: number) => {
	if (count === undefined) {
		return `${CSI}B`;
	} else {
		return `${CSI}${count}B`;
	}
};

/**
 * Makes a CUF (Cursor Forward) escape sequence.
 * @param count The count.
 * @returns The CUF escape sequence.
 */
const makeCUF = (count?: number) => {
	if (count === undefined) {
		return `${CSI}C`;
	} else {
		return `${CSI}${count}C`;
	}
};

/**
 * Makes a CUP (Cursor Position) escape sequence.
 * @param line The line.
 * @param column The column.
 * @returns The CUP escape sequence.
 */
const makeCUP = (line?: number, column?: number) => {
	if (line === undefined && column === undefined) {
		return `${CSI}H`;
	} else if (line !== undefined && column === undefined) {
		return `${CSI}${line}H`;
	} else if (line === undefined && column !== undefined) {
		return `${CSI};${column}H`;
	} else {
		return `${CSI}${line};${column}H`;
	}
};

/**
 * Makes a CUU (Cursor Up) escape sequence.
 * @param count The count.
 * @returns The CUU escape sequence.
 */
const makeCUU = (count?: number) => {
	if (count === undefined) {
		return `${CSI}A`;
	} else {
		return `${CSI}${count}A`;
	}
};

/**
 * Makes an ED (Erase in Display) escape sequence.
 * @param direction The direction.
 * @returns The ED escape sequence.
 */
const makeED = (direction: 'end-of-screen' | 'end-of-screen-explicit-0' | 'beginning-of-screen' | 'entire-screen' = 'end-of-screen') => {
	switch (direction) {
		case 'end-of-screen':
			return `${CSI}J`;

		case 'end-of-screen-explicit-0':
			return `${CSI}0J`;

		case 'beginning-of-screen':
			return `${CSI}1J`;

		case 'entire-screen':
			return `${CSI}2J`;
	}
};

/**
 * Makes an EL (Erase in Line) escape sequence.
 * @param count The count.
 * @returns The EL escape sequence.
 */
const makeEL = (direction: 'end-of-line' | 'end-of-line-explicit-0' | 'beginning-of-line' | 'entire-line' = 'end-of-line') => {
	switch (direction) {
		case 'end-of-line':
			return `${CSI}K`;

		case 'end-of-line-explicit-0':
			return `${CSI}0K`;

		case 'beginning-of-line':
			return `${CSI}1K`;

		case 'entire-line':
			return `${CSI}2K`;
	}
};

/**
 * Makes an SGR (Select Graphic Rendition) escape sequence from standard SGR parameters.
 * @param parameters The SGR parameters.
 * @returns The SGR escape sequence.
 */
const makeSGR = (...parameters: SGRParam[]) => {
	return CSI + parameters.map(parameter => `${parameter}`).join(';') + 'm';
};

/**
 * Converts a number to a two-digit hex string representing the value.
 * @param value The value.
 * @returns A two digit hex string representing the value.
 */
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
 * ANSIOutout suite.
 */
suite('ANSIOutout', () => {
	test('Test ANSIOutput.processOutput with empty string', () => {
		// Setup.
		const outputLines = ANSIOutput.processOutput("");

		// Tests.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns.length, 0);
	});

	test('Test ANSIOutput.processOutput with PANGRAM', () => {
		// Setup.
		const outputLines = ANSIOutput.processOutput(PANGRAM);

		// Tests.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].text, PANGRAM);
	});

	test('Test ANSIOutput with no output', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		const outputLines = ansiOutput.outputLines;

		// Tests.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 0);
	});

	test('Test ANSIOutput with PANGRAM', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(PANGRAM);
		const outputLines = ansiOutput.outputLines;

		// Tests.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].text, PANGRAM);
	});

	test('Test ANSIOutput with two lines separated by LF', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${PANGRAM}${LF}${PANGRAM}`);
		const outputLines = ansiOutput.outputLines;

		// Test
		assert.equal(outputLines.length, 2);
		for (let i = 0; i < outputLines.length; i++) {
			assert.equal(outputLines[i].outputRuns.length, 1);
			assert.equal(outputLines[i].outputRuns[0].id.length, 36);
			assert.equal(outputLines[i].outputRuns[0].format, undefined);
			assert.equal(outputLines[i].outputRuns[0].text, PANGRAM);
		}
	});

	test('Test ANSIOutput with two lines separated by CRLF', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${PANGRAM}${CRLF}${PANGRAM}`);
		const outputLines = ansiOutput.outputLines;

		// Test
		assert.equal(outputLines.length, 2);
		for (let i = 0; i < outputLines.length; i++) {
			assert.equal(outputLines[i].outputRuns.length, 1);
			assert.equal(outputLines[i].outputRuns[0].id.length, 36);
			assert.equal(outputLines[i].outputRuns[0].format, undefined);
			assert.equal(outputLines[i].outputRuns[0].text, PANGRAM);
		}
	});

	test('Test ANSIOutput with 10 lines separated by LF and CRLF', () => {
		testOutputLines(10, LF);
		testOutputLines(10, CRLF);
	});

	test('Test ANSIOutput with 100 lines separated by LF and CRLF', () => {
		testOutputLines(100, LF);
		testOutputLines(100, CRLF);
	});

	test('Test ANSIOutput with 2,500 output lines separated by LF and CRLF', () => {
		testOutputLines(2500, LF);
		testOutputLines(2500, CRLF);
	});

	test('Test ANSIOutput with 10,000 output lines separated by LF and CRLF', () => {
		testOutputLines(10000, LF);
		testOutputLines(10000, CRLF);
	});

	const testOutputLines = (count: number, terminator: string) => {
		// Setup.
		const lines = makeLines(10);
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(lines.join(LF));
		const outputLines = ansiOutput.outputLines;

		// Tests.
		assert.equal(outputLines.length, lines.length);
		for (let i = 0; i < outputLines.length; i++) {
			if (!lines[i].length) {
				assert.equal(outputLines[i].outputRuns.length, 0);
			} else {
				assert.equal(outputLines[i].id.length, 36);
				assert.equal(outputLines[i].outputRuns.length, 1);
				assert.equal(outputLines[i].outputRuns[0].text.length, lines[i].length);
			}
		}
	};

	test('Test CUB (Cursor Backward)', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));

		// Test.
		ansiOutput.processOutput(makeCUB());
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 79);
		ansiOutput.processOutput(makeCUB(1));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 78);
		ansiOutput.processOutput(makeCUB(10));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 68);
		ansiOutput.processOutput(makeCUB(100));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 0);
	});

	test('Test CUB (Cursor Backward) to start of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput("XXXXXXXXXX");
		const outputLines = ansiOutput.outputLines;

		// Test.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "XXXXXXXXXX0000000000000000000000000000000000000000000000000000000000000000000000");
	});

	test('Test CUB (Cursor Backward) to middle of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUB(45));
		ansiOutput.processOutput("XXXXXXXXXX");
		const outputLines = ansiOutput.outputLines;

		// Test.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "00000000000000000000000000000000000XXXXXXXXXX00000000000000000000000000000000000");
	});

	test('Test CUB (Cursor Backward) to end of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUB(10));
		ansiOutput.processOutput("XXXXXXXXXX");
		const outputLines = ansiOutput.outputLines;

		// Test.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "0000000000000000000000000000000000000000000000000000000000000000000000XXXXXXXXXX");
	});

	test('Test CUD (Cursor Down)', () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP());

		// Test.
		ansiOutput.processOutput(makeCUD());
		assert.equal(ansiOutput["_outputLine"] as number, 1);
		assert.equal(ansiOutput["_outputColumn"] as number, 0);
		ansiOutput.processOutput(makeCUD(1));
		assert.equal(ansiOutput["_outputLine"] as number, 2);
		assert.equal(ansiOutput["_outputColumn"] as number, 0);
		ansiOutput.processOutput(makeCUD(10));
		assert.equal(ansiOutput["_outputLine"] as number, 12);
		assert.equal(ansiOutput["_outputColumn"] as number, 0);
		ansiOutput.processOutput(makeCUD(100));
		assert.equal(ansiOutput["_outputLine"] as number, 112);
		assert.equal(ansiOutput["_outputColumn"] as number, 0);
	});

	test('Test CUF (Cursor Forward)', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUP());

		// Test.
		ansiOutput.processOutput(makeCUF());
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 1);
		ansiOutput.processOutput(makeCUF(1));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 2);
		ansiOutput.processOutput(makeCUF(10));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 12);
		ansiOutput.processOutput(makeCUF(100));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 112);
	});

	test('Test CUF (Cursor Forward) to start of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput(makeCUF());
		ansiOutput.processOutput("XXXXXXXXXX");
		const outputLines = ansiOutput.outputLines;

		// Test.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "0XXXXXXXXXX000000000000000000000000000000000000000000000000000000000000000000000");
	});

	test('Test CUF (Cursor Forward) to middle of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput(makeCUF(35));
		ansiOutput.processOutput("XXXXXXXXXX");
		const outputLines = ansiOutput.outputLines;

		// Test.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "00000000000000000000000000000000000XXXXXXXXXX00000000000000000000000000000000000");
	});

	test('Test CUF (Cursor Forward) to end of line', () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUB(80));
		ansiOutput.processOutput(makeCUF(70));
		ansiOutput.processOutput("XXXXXXXXXX");
		const outputLines = ansiOutput.outputLines;

		// Test.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.equal(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "0000000000000000000000000000000000000000000000000000000000000000000000XXXXXXXXXX");
	});

	test("Tests CUP (Cursor Position)", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();

		// Test.
		ansiOutput.processOutput(makeCUP());
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 0);
		ansiOutput.processOutput(makeCUP(10, 10));
		assert.equal(ansiOutput["_outputLine"] as number, 9);
		assert.equal(ansiOutput["_outputColumn"] as number, 9);
		ansiOutput.processOutput(makeCUP(100, 100));
		assert.equal(ansiOutput["_outputLine"] as number, 99);
		assert.equal(ansiOutput["_outputColumn"] as number, 99);
		ansiOutput.processOutput(makeCUP(8192, 8192));
		assert.equal(ansiOutput["_outputLine"] as number, 8191);
		assert.equal(ansiOutput["_outputColumn"] as number, 8191);
	});

	test("Tests CUU (Cursor Up)", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();

		// Test.
		ansiOutput.processOutput(makeCUU());
		assert.equal(ansiOutput["_outputLine"] as number, 23);
		assert.equal(ansiOutput["_outputColumn"] as number, 80);
		ansiOutput.processOutput(makeCUU(1));
		assert.equal(ansiOutput["_outputLine"] as number, 22);
		assert.equal(ansiOutput["_outputColumn"] as number, 80);
		ansiOutput.processOutput(makeCUU(10));
		assert.equal(ansiOutput["_outputLine"] as number, 12);
		assert.equal(ansiOutput["_outputColumn"] as number, 80);
		ansiOutput.processOutput(makeCUU(20));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 80);
	});

	test("Tests end of screen ED using implicit 0", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP(13, 41));

		// Test.
		ansiOutput.processOutput(makeED("end-of-screen"));
		const zeros = "0".repeat(80);
		for (let i = 0; i < 12; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, zeros);
		}
		assert.equal(ansiOutput.outputLines[12].outputRuns.length, 2);
		assert.equal(ansiOutput.outputLines[12].outputRuns[0].text, "0000000000000000000000000000000000000000");
		assert.equal(ansiOutput.outputLines[12].outputRuns[1].text, "                                        ");
		const spaces = " ".repeat(80);
		for (let i = 13; i < 24; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, spaces);
		}
	});

	test("Tests end of screen ED using explicit 0", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP(13, 41));

		// Test.
		assert.equal(ansiOutput["_outputLine"] as number, 12);
		assert.equal(ansiOutput["_outputColumn"] as number, 40);
		ansiOutput.processOutput(makeED("end-of-screen-explicit-0"));
		const zeros = "0".repeat(80);
		for (let i = 0; i < 12; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, zeros);
		}
		assert.equal(ansiOutput.outputLines[12].outputRuns.length, 2);
		assert.equal(ansiOutput.outputLines[12].outputRuns[0].text, "0000000000000000000000000000000000000000");
		assert.equal(ansiOutput.outputLines[12].outputRuns[1].text, "                                        ");
		const spaces = " ".repeat(80);
		for (let i = 13; i < 24; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, spaces);
		}
	});

	test("Tests ED 1", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP(13, 41));

		// Test.
		assert.equal(ansiOutput["_outputLine"] as number, 12);
		assert.equal(ansiOutput["_outputColumn"] as number, 40);
		ansiOutput.processOutput(makeED("beginning-of-screen"));
		const spaces = " ".repeat(80);
		for (let i = 0; i < 12; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, spaces);
		}
		assert.equal(ansiOutput.outputLines[12].outputRuns.length, 2);
		assert.equal(ansiOutput.outputLines[12].outputRuns[0].text, "                                        ");
		assert.equal(ansiOutput.outputLines[12].outputRuns[1].text, "0000000000000000000000000000000000000000");
		const zeros = "0".repeat(80);
		for (let i = 13; i < 24; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, zeros);
		}
	});

	test("Tests ED 2 from the bottom", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();

		// Test.
		ansiOutput.processOutput(makeED("entire-screen"));
		assert.equal(ansiOutput["_outputLine"] as number, 24);
		assert.equal(ansiOutput["_outputColumn"] as number, 80);
		assert.equal(ansiOutput.outputLines.length, 25);
		const spaces = " ".repeat(80);
		for (let i = 0; i < 25; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, spaces);
		}
	});

	test("Tests ED 2 from the top", () => {
		// Setup.
		const ansiOutput = setupStandardScreen();
		ansiOutput.processOutput(makeCUP());

		// Test.
		ansiOutput.processOutput(makeED("entire-screen"));
		assert.equal(ansiOutput["_outputLine"] as number, 0);
		assert.equal(ansiOutput["_outputColumn"] as number, 0);
		assert.equal(ansiOutput.outputLines.length, 25);
		const spaces = " ".repeat(80);
		for (let i = 0; i < 25; i++) {
			assert.equal(ansiOutput.outputLines[i].outputRuns.length, 1);
			assert.equal(ansiOutput.outputLines[i].outputRuns[0].text, spaces);
		}
	});

	test("Tests EL 0 when there's nothing to clear", () => {
		// Setup.
		const ansiOutput = new ANSIOutput();

		// Test.
		ansiOutput.processOutput(makeEL("end-of-line"));
		assert.equal(ansiOutput.outputLines[0].outputRuns.length, 0);
	});

	test("Tests EL 0 using implicit 0", () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(CR);

		// Test.
		ansiOutput.processOutput(makeEL("end-of-line"));
		assert.equal(ansiOutput.outputLines[0].outputRuns.length, 1);
		assert.equal(ansiOutput.outputLines[0].outputRuns[0].text, " ".repeat(80));
	});

	test("Tests EL 0 using explicit 0", () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(CR);

		// Test.
		ansiOutput.processOutput(makeEL("end-of-line-explicit-0"));
		assert.equal(ansiOutput.outputLines[0].outputRuns.length, 1);
		assert.equal(ansiOutput.outputLines[0].outputRuns[0].text, " ".repeat(80));
	});

	test("Tests EL 1", () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));

		// Test.
		ansiOutput.processOutput(makeEL("beginning-of-line"));
		assert.equal(ansiOutput.outputLines[0].outputRuns.length, 1);
		assert.equal(ansiOutput.outputLines[0].outputRuns[0].text, " ".repeat(80));
	});

	test("Tests EL 2", () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput("0".repeat(80));
		ansiOutput.processOutput(makeCUP(1, 41));

		// Test.
		ansiOutput.processOutput(makeEL("entire-line"));
		assert.equal(ansiOutput.outputLines[0].outputRuns.length, 1);
		assert.equal(ansiOutput.outputLines[0].outputRuns[0].text, " ".repeat(80));
	});

	test("Tests foreground colors with no background colors", () => {
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
			assert.equal(outputLines.length, 1);
			assert.equal(outputLines[0].outputRuns.length, 1);

			// Test that the output run text is correct.
			assert.equal(outputLines[0].outputRuns[0].text, PANGRAM);

			// Test that the output format is correct.
			assert.notEqual(outputLines[0].outputRuns[0].format, undefined);
			assert.equal(outputLines[0].outputRuns[0].format!.styles, testScenario.ansiFormat.styles);
			assert.equal(outputLines[0].outputRuns[0].format!.foregroundColor, testScenario.ansiFormat.foregroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.backgroundColor, testScenario.ansiFormat.backgroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.underlinedColor, testScenario.ansiFormat.underlinedColor);
			assert.equal(outputLines[0].outputRuns[0].format!.font, testScenario.ansiFormat.font);
		}
	});

	test("Tests background colors and automatically contrasting foreground colors", () => {
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
			assert.equal(outputLines.length, 1);
			assert.equal(outputLines[0].outputRuns.length, 1);

			// Test that the output run text is correct.
			assert.equal(outputLines[0].outputRuns[0].text, PANGRAM);

			// Test that the output format is correct.
			assert.notEqual(outputLines[0].outputRuns[0].format, undefined);
			assert.equal(outputLines[0].outputRuns[0].format!.styles, testScenario.ansiFormat.styles);
			assert.equal(outputLines[0].outputRuns[0].format!.foregroundColor, testScenario.ansiFormat.foregroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.backgroundColor, testScenario.ansiFormat.backgroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.underlinedColor, testScenario.ansiFormat.underlinedColor);
			assert.equal(outputLines[0].outputRuns[0].format!.font, testScenario.ansiFormat.font);
		}
	});

	test("Tests ANSI 16 matrix", () => {
		/**
		 * SGRToAnsiColorMap type.
		 */
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
			assert.equal(outputLines.length, 1);
			assert.equal(outputLines[0].outputRuns.length, 1);

			// Test that the output run text is correct.
			assert.equal(outputLines[0].outputRuns[0].text, PANGRAM);

			// Test that the output format is correct.
			assert.notEqual(outputLines[0].outputRuns[0].format, undefined);
			assert.equal(outputLines[0].outputRuns[0].format!.styles, testScenario.ansiFormat.styles);
			assert.equal(outputLines[0].outputRuns[0].format!.foregroundColor, testScenario.ansiFormat.foregroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.backgroundColor, testScenario.ansiFormat.backgroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.underlinedColor, testScenario.ansiFormat.underlinedColor);
			assert.equal(outputLines[0].outputRuns[0].format!.font, testScenario.ansiFormat.font);
		}
	});

	test("Tests ANSI 256 matrix", () => {
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
			assert.equal(outputLines.length, 1);
			assert.equal(outputLines[0].outputRuns.length, 1);

			// Test that the output run text is correct.
			assert.equal(outputLines[0].outputRuns[0].text, PANGRAM);

			// Test that the output format is correct.
			assert.notEqual(outputLines[0].outputRuns[0].format, undefined);
			assert.equal(outputLines[0].outputRuns[0].format!.styles, testScenario.ansiFormat.styles);
			assert.equal(outputLines[0].outputRuns[0].format!.foregroundColor, testScenario.ansiFormat.foregroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.backgroundColor, testScenario.ansiFormat.backgroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.underlinedColor, testScenario.ansiFormat.underlinedColor);
			assert.equal(outputLines[0].outputRuns[0].format!.font, testScenario.ansiFormat.font);
		}
	});

	test("Tests ANSI RGB matrix", () => {
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
			assert.equal(outputLines.length, 1);
			assert.equal(outputLines[0].outputRuns.length, 1);

			// Test that the output run text is correct.
			assert.equal(outputLines[0].outputRuns[0].text, PANGRAM);

			// Test that the output format is correct.
			assert.notEqual(outputLines[0].outputRuns[0].format, undefined);
			assert.equal(outputLines[0].outputRuns[0].format!.styles, testScenario.ansiFormat.styles);
			assert.equal(outputLines[0].outputRuns[0].format!.foregroundColor, testScenario.ansiFormat.foregroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.backgroundColor, testScenario.ansiFormat.backgroundColor);
			assert.equal(outputLines[0].outputRuns[0].format!.underlinedColor, testScenario.ansiFormat.underlinedColor);
			assert.equal(outputLines[0].outputRuns[0].format!.font, testScenario.ansiFormat.font);
		}
	});

	test("Tests insertion of blue text into an output run of red text", () => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		// Create a red output run.
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundRed)}${"0".repeat(80)}${makeSGR()}`);
		// Insert a blue output in the middle of the red output run.
		ansiOutput.processOutput(makeCUB(45));
		ansiOutput.processOutput(`${makeSGR(SGRParam.ForegroundBlue)}XXXXXXXXXX${makeSGR()}`);
		const outputLines = ansiOutput.outputLines;

		// Test.
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 3);

		// First red segment.
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.notEqual(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.styles, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.foregroundColor, ANSIColor.Red);
		assert.equal(outputLines[0].outputRuns[0].format!.backgroundColor, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.underlinedColor, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.font, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "00000000000000000000000000000000000");

		// Inserted blue segment.
		assert.equal(outputLines[0].outputRuns[1].id.length, 36);
		assert.notEqual(outputLines[0].outputRuns[1].format, undefined);
		assert.equal(outputLines[0].outputRuns[1].format!.styles, undefined);
		assert.equal(outputLines[0].outputRuns[1].format!.foregroundColor, ANSIColor.Blue);
		assert.equal(outputLines[0].outputRuns[1].format!.backgroundColor, undefined);
		assert.equal(outputLines[0].outputRuns[1].format!.underlinedColor, undefined);
		assert.equal(outputLines[0].outputRuns[1].format!.font, undefined);
		assert.equal(outputLines[0].outputRuns[1].text, "XXXXXXXXXX");

		// Second red segment.
		assert.equal(outputLines[0].outputRuns[2].id.length, 36);
		assert.notEqual(outputLines[0].outputRuns[2].format, undefined);
		assert.equal(outputLines[0].outputRuns[2].format!.styles, undefined);
		assert.equal(outputLines[0].outputRuns[2].format!.foregroundColor, ANSIColor.Red);
		assert.equal(outputLines[0].outputRuns[2].format!.backgroundColor, undefined);
		assert.equal(outputLines[0].outputRuns[2].format!.underlinedColor, undefined);
		assert.equal(outputLines[0].outputRuns[2].format!.font, undefined);
		assert.equal(outputLines[0].outputRuns[2].text, "00000000000000000000000000000000000");
	});

	const testStyle = (sgr: SGRParam, ansiStyle: ANSIStyle) => {
		// Setup.
		const ansiOutput = new ANSIOutput();
		ansiOutput.processOutput(`${makeSGR(sgr)}${"0".repeat(80)}${makeSGR()}`);
		const outputLines = ansiOutput.outputLines;
		assert.equal(outputLines.length, 1);
		assert.equal(outputLines[0].outputRuns.length, 1);
		assert.equal(outputLines[0].outputRuns[0].id.length, 36);
		assert.notEqual(outputLines[0].outputRuns[0].format, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.styles!.length, 1);
		assert.equal(outputLines[0].outputRuns[0].format!.styles![0], ansiStyle);
		assert.equal(outputLines[0].outputRuns[0].format!.foregroundColor, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.backgroundColor, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.underlinedColor, undefined);
		assert.equal(outputLines[0].outputRuns[0].format!.font, undefined);
		assert.equal(outputLines[0].outputRuns[0].text, "0".repeat(80));
	};

	test("Tests styles", () => {
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
});

//#endregion Test Suite
