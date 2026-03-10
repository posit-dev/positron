"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Profiler = void 0;
exports.generateUuid = generateUuid;
const { decode_bytes } = require('@vscode/v8-heap-parser');
class Profiler {
    code;
    constructor(code) {
        this.code = code;
    }
    async checkObjectLeaks(classNames, fn) {
        await this.code.driver.startCDP();
        const classNamesArray = Array.isArray(classNames) ? classNames : [classNames];
        const countsBefore = await getInstances(this.code.driver, classNamesArray);
        await fn();
        const countAfter = await getInstances(this.code.driver, classNamesArray);
        const leaks = [];
        for (const className of classNamesArray) {
            const count = countAfter[className] ?? 0;
            const countBefore = countsBefore[className] ?? 0;
            if (count !== countBefore) {
                leaks.push(`Leaked ${count - countBefore} ${className}`);
            }
        }
        if (leaks.length > 0) {
            throw new Error(leaks.join('\n'));
        }
    }
    async checkHeapLeaks(classNames, fn) {
        await this.code.driver.startCDP();
        await fn();
        const heapSnapshotAfter = await this.code.driver.takeHeapSnapshot();
        const buff = Buffer.from(heapSnapshotAfter);
        const graph = await decode_bytes(buff);
        const counts = Array.from(graph.get_class_counts(classNames));
        const leaks = [];
        for (let i = 0; i < classNames.length; i++) {
            if (counts[i] > 0) {
                leaks.push(`Leaked ${counts[i]} ${classNames[i]}`);
            }
        }
        if (leaks.length > 0) {
            throw new Error(leaks.join('\n'));
        }
    }
}
exports.Profiler = Profiler;
/**
 * Copied from src/vs/base/common/uuid.ts
 */
function generateUuid() {
    // use `randomUUID` if possible
    if (typeof crypto.randomUUID === 'function') {
        // see https://developer.mozilla.org/en-US/docs/Web/API/Window/crypto
        // > Although crypto is available on all windows, the returned Crypto object only has one
        // > usable feature in insecure contexts: the getRandomValues() method.
        // > In general, you should use this API only in secure contexts.
        return crypto.randomUUID.bind(crypto)();
    }
    // prep-work
    const _data = new Uint8Array(16);
    const _hex = [];
    for (let i = 0; i < 256; i++) {
        _hex.push(i.toString(16).padStart(2, '0'));
    }
    // get data
    crypto.getRandomValues(_data);
    // set version bits
    _data[6] = (_data[6] & 0x0f) | 0x40;
    _data[8] = (_data[8] & 0x3f) | 0x80;
    // print as string
    let i = 0;
    let result = '';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    return result;
}
/*---------------------------------------------------------------------------------------------
 *  The MIT License (MIT)
 *  Copyright (c) 2023-present, Simon Siefke
 *
 *  This code is derived from https://github.com/SimonSiefke/vscode-memory-leak-finder
 *--------------------------------------------------------------------------------------------*/
const getInstances = async (driver, classNames) => {
    await driver.collectGarbage();
    const objectGroup = `og:${generateUuid()}`;
    const prototypeDescriptor = await driver.evaluate({
        expression: 'Object.prototype',
        returnByValue: false,
        objectGroup,
    });
    const objects = await driver.queryObjects({
        prototypeObjectId: prototypeDescriptor.result.objectId,
        objectGroup,
    });
    const fnResult1 = await driver.callFunctionOn({
        functionDeclaration: `function(){
	const objects = this
	const classNames = ${JSON.stringify(classNames)}

	const nativeConstructors = [
		Object,
		Array,
		Function,
		Set,
		Map,
		WeakMap,
		WeakSet,
		RegExp,
		Node,
		HTMLScriptElement,
		DOMRectReadOnly,
		DOMRect,
		HTMLHtmlElement,
		Node,
		DOMTokenList,
		HTMLUListElement,
		HTMLStyleElement,
		HTMLDivElement,
		HTMLCollection,
		FocusEvent,
		Promise,
		HTMLLinkElement,
		HTMLLIElement,
		HTMLAnchorElement,
		HTMLSpanElement,
		ArrayBuffer,
		Uint16Array,
		HTMLLabelElement,
		TrustedTypePolicy,
		Uint8Array,
		Uint32Array,
		HTMLHeadingElement,
		MediaQueryList,
		HTMLDocument,
		TextDecoder,
		TextEncoder,
		HTMLInputElement,
		HTMLCanvasElement,
		HTMLIFrameElement,
		Int32Array,
		CSSStyleDeclaration
	]

	const isNativeConstructor = object => {
		return nativeConstructors.includes(object.constructor) ||
			object.constructor.name === 'AsyncFunction' ||
			object.constructor.name === 'GeneratorFunction' ||
			object.constructor.name === 'AsyncGeneratorFunction'
	}

	const isInstance = (object) => {
		return object && !isNativeConstructor(object)
	}

	const instances = objects.filter(isInstance)

	const counts = Object.create(null)
	for(const instance of instances){
		const name=instance.constructor.name
		if(classNames.includes(name)){
			counts[name]||= 0
			counts[name]++
		}
	}
	return counts
}`,
        objectId: objects.objects.objectId,
        returnByValue: true,
        objectGroup,
    });
    const returnObject = fnResult1.result.value;
    await driver.releaseObjectGroup({ objectGroup: objectGroup });
    return returnObject;
};
//# sourceMappingURL=profiler.js.map