import { isWindows } from '../../../../common/utils/platformUtils';

export function hasStartupCode(content: string, start: string, end: string, keys: string[]): boolean {
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const startIndex = normalizedContent.indexOf(start);
    const endIndex = normalizedContent.indexOf(end);
    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
        return false;
    }
    const contentBetween = normalizedContent.substring(startIndex + start.length, endIndex).trim();
    return contentBetween.length > 0 && keys.every((key) => contentBetween.includes(key));
}

function getLineEndings(content: string): string {
    if (content.includes('\r\n')) {
        return '\r\n';
    } else if (content.includes('\n')) {
        return '\n';
    }
    return isWindows() ? '\r\n' : '\n';
}

export function insertStartupCode(content: string, start: string, end: string, code: string): string {
    let lineEnding = getLineEndings(content);
    const normalizedContent = content.replace(/\r\n/g, '\n');

    const startIndex = normalizedContent.indexOf(start);
    const endIndex = normalizedContent.indexOf(end);

    let result: string;
    if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
        result =
            normalizedContent.substring(0, startIndex + start.length) +
            '\n' +
            code +
            '\n' +
            normalizedContent.substring(endIndex);
    } else if (startIndex !== -1) {
        result = normalizedContent.substring(0, startIndex + start.length) + '\n' + code + '\n' + end + '\n';
    } else {
        result = normalizedContent + '\n' + start + '\n' + code + '\n' + end + '\n';
    }

    if (lineEnding === '\r\n') {
        result = result.replace(/\n/g, '\r\n');
    }
    return result;
}

export function removeStartupCode(content: string, start: string, end: string): string {
    let lineEnding = getLineEndings(content);
    const normalizedContent = content.replace(/\r\n/g, '\n');

    const startIndex = normalizedContent.indexOf(start);
    const endIndex = normalizedContent.indexOf(end);

    if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
        const before = normalizedContent.substring(0, startIndex);
        const after = normalizedContent.substring(endIndex + end.length);

        let result: string;
        if (before === '') {
            result = after.startsWith('\n') ? after.substring(1) : after;
        } else if (after === '' || after === '\n') {
            result = before.endsWith('\n') ? before.substring(0, before.length - 1) : before;
        } else if (after.startsWith('\n') && before.endsWith('\n')) {
            result = before + after.substring(1);
        } else {
            result = before + after;
        }

        if (lineEnding === '\r\n') {
            result = result.replace(/\n/g, '\r\n');
        }
        return result;
    }
    return content;
}
