/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';

import { Event } from './event';

export enum LogLevel {
	Trace = 1,
	Debug = 2,
	Info = 3,
	Warning = 4,
	Error = 5,
	Critical = 6,
	Off = 7
}

export type LogFormat = 'text' | 'json';

const logLevelMap = {
	info: LogLevel.Info,
	debug: LogLevel.Debug,
	trace: LogLevel.Trace,
	error: LogLevel.Error,
};

type logLevelString = keyof typeof logLevelMap;

export function mapLogLevel(text: logLevelString) {
	return logLevelMap[text] || LogLevel.Info;
}

export type LogEvent = {
	type: 'text' | 'raw' | 'start' | 'stop' | 'progress';
	channel?: string;
} & (
		{
			type: 'text' | 'raw' | 'start';
			level: LogLevel; // TODO: Change to string for stringifycation.
			timestamp: number;
			text: string;
		} |
		{
			type: 'stop';
			level: LogLevel;
			timestamp: number;
			text: string;
			startTimestamp: number;
		} |
		{
			type: 'progress';
			name: string;
			status: 'running' | 'succeeded' | 'failed';
			stepDetail?: string;
		}
	);

export interface LogHandler {
	event(e: LogEvent): void;
	dimensions?: LogDimensions;
	onDidChangeDimensions?: Event<LogDimensions>;
}

export interface Log {
	write(text: string, level?: LogLevel): void;
	raw(text: string, level?: LogLevel): void;
	start(text: string, level?: LogLevel): number;
	stop(text: string, start: number, level?: LogLevel): void;
	event(e: LogEvent): void;
	dimensions?: LogDimensions;
	onDidChangeDimensions?: Event<LogDimensions>;
}

export interface LogDimensions {
	columns: number;
	rows: number;
}

export const nullLog: Log = {
	write: () => undefined,
	raw: () => undefined,
	start: () => Date.now(),
	stop: () => undefined,
	event: () => undefined,
};

export const terminalEscapeSequences = /(\x9B|\x1B\[)[0-?]*[ -\/]*[@-~]/g; // https://stackoverflow.com/questions/14693701/how-can-i-remove-the-ansi-escape-sequences-from-a-string-in-python/33925425#33925425

export function createCombinedLog(logs: LogHandler[], header?: string): LogHandler {
	let sendHeader = !!header;
	return {
		event: e => {
			if (sendHeader) {
				sendHeader = false;
				logs.forEach(log => log.event({
					type: 'text',
					level: LogLevel.Info,
					timestamp: Date.now(),
					text: header!,
				}));
			}
			logs.forEach(log => log.event(e));
		}
	};
}

export function createPlainLog(write: (text: string) => void, getLogLevel: () => LogLevel): LogHandler {
	return {
		event(e) {
			const text = logEventToFileText(e, getLogLevel());
			if (text) {
				write(text);
			}
		},
	};
}

export function createTerminalLog(write: (text: string) => void, _getLogLevel: () => LogLevel, _sessionStart: Date): LogHandler {
	return {
		event(e) {
			const text = logEventToTerminalText(e, _getLogLevel(), _sessionStart.getTime());
			if (text) {
				write(text);
			}
		}
	};
}

export function createJSONLog(write: (text: string) => void, _getLogLevel: () => LogLevel, _sessionStart: Date): LogHandler {
	return {
		event(e) {
			write(JSON.stringify(e) + '\n');
		}
	};
}

export function makeLog(log: LogHandler, defaultLogEventLevel = LogLevel.Debug): Log {
	return {
		event: log.event,
		write(text: string, level = defaultLogEventLevel) {
			log.event({
				type: 'text',
				level,
				timestamp: Date.now(),
				text,
			});
		},
		raw(text: string, level = defaultLogEventLevel) {
			log.event({
				type: 'raw',
				level,
				timestamp: Date.now(),
				text,
			});
		},
		start(text: string, level = defaultLogEventLevel) {
			const timestamp = Date.now();
			log.event({
				type: 'start',
				level,
				timestamp,
				text,
			});
			return timestamp;
		},
		stop(text: string, startTimestamp: number, level = defaultLogEventLevel) {
			log.event({
				type: 'stop',
				level,
				timestamp: Date.now(),
				text,
				startTimestamp,
			});
		},
		get dimensions() {
			return log.dimensions;
		},
		onDidChangeDimensions: log.onDidChangeDimensions,
	};
}

export function logEventToTerminalText(e: LogEvent, logLevel: LogLevel, startTimestamp: number) {
	if (!('level' in e) || e.level < logLevel) {
		return undefined;
	}
	switch (e.type) {
		case 'text': return `[${color(timestampColor, `${e.timestamp - startTimestamp} ms`)}] ${toTerminalText(e.text)}`;
		case 'raw': return e.text;
		case 'start':
			if (LogLevel.Trace >= logLevel) {
				return `${color(startColor, `[${e.timestamp - startTimestamp} ms] Start`)}: ${toTerminalText(e.text)}`;
			}
			return `[${color(timestampColor, `${e.timestamp - startTimestamp} ms`)}] Start: ${toTerminalText(e.text)}`;
		case 'stop':
			if (LogLevel.Trace >= logLevel) {
				return `${color(stopColor, `[${e.timestamp - startTimestamp} ms] Stop`)} (${e.timestamp - e.startTimestamp} ms): ${toTerminalText(e.text)}`;
			}
			return undefined;
		default: throw neverLogEventError(e);
	}
}

function toTerminalText(text: string) {
	return colorize(text)
		.replace(/\r?\n/g, '\r\n').replace(/(\r?\n)?$/, '\r\n');
}

function logEventToFileText(e: LogEvent, logLevel: LogLevel) {
	if (!('level' in e) || e.level < logLevel) {
		return undefined;
	}
	switch (e.type) {
		case 'text':
		case 'raw': return `[${new Date(e.timestamp).toISOString()}] ${toLogFileText(e.text)}`;
		case 'start': return `[${new Date(e.timestamp).toISOString()}] Start: ${toLogFileText(e.text)}`;
		case 'stop':
			if (LogLevel.Debug >= logLevel) {
				return `[${new Date(e.timestamp).toISOString()}] Stop (${e.timestamp - e.startTimestamp} ms): ${toLogFileText(e.text)}`;
			}
			return undefined;
		default: throw neverLogEventError(e);
	}
}

function toLogFileText(text: string) {
	return text.replace(terminalEscapeSequences, '')
		.replace(/(\r?\n)?$/, os.EOL);
}

function neverLogEventError(e: never) {
	return new Error(`Unknown log event type: ${(e as LogEvent).type}`);
}

// foreground 38;2;<r>;<g>;<b> (https://stackoverflow.com/questions/4842424/list-of-ansi-color-escape-sequences)
const red = '38;2;143;99;79';
const green = '38;2;99;143;79';
const blue = '38;2;86;156;214';
export const stopColor = red;
export const startColor = green;
export const timestampColor = green;
export const numberColor = blue;
export function color(color: string, str: string) {
	return str.split('\n')
		.map(line => `[1m[${color}m${line}[39m[22m`)
		.join('\n');
}

export function colorize(text: string) {
	let m: RegExpExecArray | null;
	let lastIndex = 0;
	const fragments: string[] = [];
	terminalEscapeSequences.lastIndex = 0;
	while (m = terminalEscapeSequences.exec(text)) {
		fragments.push(colorizePlainText(text.substring(lastIndex, m.index)));
		fragments.push(m[0]);
		lastIndex = terminalEscapeSequences.lastIndex;
	}
	fragments.push(colorizePlainText(text.substr(lastIndex)));
	return fragments.join('');
}

function colorizePlainText(text: string) {
	const num = /(?<=^|[^A-Za-z0-9_\-\.])[0-9]+(\.[0-9]+)*(?=$|[^A-Za-z0-9_\-\.])/g;
	let m: RegExpExecArray | null;
	let lastIndex = 0;
	const fragments: string[] = [];
	while (m = num.exec(text)) {
		fragments.push(text.substring(lastIndex, m.index));
		fragments.push(color(numberColor, m[0]));
		lastIndex = num.lastIndex;
	}
	fragments.push(text.substr(lastIndex));
	return fragments.join('');
}

export function toErrorText(str: string) {
	return str.split(/\r?\n/)
		.map(line => `[1m[31m${line}[39m[22m`)
		.join('\r\n') + '\r\n';
}

export function toWarningText(str: string) {
	return str.split(/\r?\n/)
		.map(line => `[1m[33m${line}[39m[22m`)
		.join('\r\n') + '\r\n';
}

export function replaceAllLog(origin: LogHandler, values: string[], replacement: string): LogHandler {
	values = values
		.filter(v => v.length)
		.sort((a, b) => b.length - a.length);
	if (!values.length) {
		return origin;
	}
	return {
		event: e => {
			if ('text' in e) {
				origin.event({
					...e,
					text: replaceValues(e.text, replacement, values),
				});
			} else if (e.type === 'progress' && e.stepDetail) {
				origin.event({
					...e,
					stepDetail: replaceValues(e.stepDetail, replacement, values),
				});
			} else {
				origin.event(e);
			}
		}
	};
}

function replaceValues(str: string, replacement: string, values: string[]) {
	values.forEach(x => {
		str = str.replaceAll(x, replacement);
	});

	return str;
}
