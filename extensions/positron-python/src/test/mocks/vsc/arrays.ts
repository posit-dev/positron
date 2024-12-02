// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/**
 * Returns the last element of an array.
 * @param array The array.
 * @param n Which element from the end (default is zero).
 */
export function tail<T>(array: T[], n = 0): T {
    return array[array.length - (1 + n)];
}

export function equals<T>(one: T[], other: T[], itemEquals: (a: T, b: T) => boolean = (a, b) => a === b): boolean {
    if (one.length !== other.length) {
        return false;
    }

    for (let i = 0, len = one.length; i < len; i += 1) {
        if (!itemEquals(one[i], other[i])) {
            return false;
        }
    }

    return true;
}

export function binarySearch<T>(array: T[], key: T, comparator: (op1: T, op2: T) => number): number {
    let low = 0;
    let high = array.length - 1;

    while (low <= high) {
        const mid = ((low + high) / 2) | 0;
        const comp = comparator(array[mid], key);
        if (comp < 0) {
            low = mid + 1;
        } else if (comp > 0) {
            high = mid - 1;
        } else {
            return mid;
        }
    }
    return -(low + 1);
}

/**
 * Takes a sorted array and a function p. The array is sorted in such a way that all elements where p(x) is false
 * are located before all elements where p(x) is true.
 * @returns the least x for which p(x) is true or array.length if no element fullfills the given function.
 */
export function findFirst<T>(array: T[], p: (x: T) => boolean): number {
    let low = 0;
    let high = array.length;
    if (high === 0) {
        return 0; // no children
    }
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (p(array[mid])) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return low;
}

/**
 * Like `Array#sort` but always stable. Usually runs a little slower `than Array#sort`
 * so only use this when actually needing stable sort.
 */
export function mergeSort<T>(data: T[], compare: (a: T, b: T) => number): T[] {
    _divideAndMerge(data, compare);
    return data;
}

function _divideAndMerge<T>(data: T[], compare: (a: T, b: T) => number): void {
    if (data.length <= 1) {
        // sorted
        return;
    }
    const p = (data.length / 2) | 0;
    const left = data.slice(0, p);
    const right = data.slice(p);

    _divideAndMerge(left, compare);
    _divideAndMerge(right, compare);

    let leftIdx = 0;
    let rightIdx = 0;
    let i = 0;
    while (leftIdx < left.length && rightIdx < right.length) {
        const ret = compare(left[leftIdx], right[rightIdx]);
        if (ret <= 0) {
            // smaller_equal -> take left to preserve order
            data[(i += 1)] = left[(leftIdx += 1)];
        } else {
            // greater -> take right
            data[(i += 1)] = right[(rightIdx += 1)];
        }
    }
    while (leftIdx < left.length) {
        data[(i += 1)] = left[(leftIdx += 1)];
    }
    while (rightIdx < right.length) {
        data[(i += 1)] = right[(rightIdx += 1)];
    }
}

export function groupBy<T>(data: T[], compare: (a: T, b: T) => number): T[][] {
    const result: T[][] = [];
    let currentGroup: T[] | undefined;

    for (const element of mergeSort(data.slice(0), compare)) {
        if (!currentGroup || compare(currentGroup[0], element) !== 0) {
            currentGroup = [element];
            result.push(currentGroup);
        } else {
            currentGroup.push(element);
        }
    }
    return result;
}

type IMutableSplice<T> = {
    deleteCount: number;
    start: number;
    toInsert: T[];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ISplice<T> = Array<T> & any;

/**
 * Diffs two *sorted* arrays and computes the splices which apply the diff.
 */
export function sortedDiff<T>(before: T[], after: T[], compare: (a: T, b: T) => number): ISplice<T>[] {
    const result: IMutableSplice<T>[] = [];

    function pushSplice(start: number, deleteCount: number, toInsert: T[]): void {
        if (deleteCount === 0 && toInsert.length === 0) {
            return;
        }

        const latest = result[result.length - 1];

        if (latest && latest.start + latest.deleteCount === start) {
            latest.deleteCount += deleteCount;
            latest.toInsert.push(...toInsert);
        } else {
            result.push({ start, deleteCount, toInsert });
        }
    }

    let beforeIdx = 0;
    let afterIdx = 0;

    while (beforeIdx !== before.length || afterIdx !== after.length) {
        const beforeElement = before[beforeIdx];
        const afterElement = after[afterIdx];
        const n = compare(beforeElement, afterElement);
        if (n === 0) {
            // equal
            beforeIdx += 1;
            afterIdx += 1;
        } else if (n < 0) {
            // beforeElement is smaller -> before element removed
            pushSplice(beforeIdx, 1, []);
            beforeIdx += 1;
        } else if (n > 0) {
            // beforeElement is greater -> after element added
            pushSplice(beforeIdx, 0, [afterElement]);
            afterIdx += 1;
        }
    }

    if (beforeIdx === before.length) {
        pushSplice(beforeIdx, 0, after.slice(afterIdx));
    } else if (afterIdx === after.length) {
        pushSplice(beforeIdx, before.length - beforeIdx, []);
    }

    return result;
}

/**
 * Takes two *sorted* arrays and computes their delta (removed, added elements).
 * Finishes in `Math.min(before.length, after.length)` steps.
 */
export function delta<T>(before: T[], after: T[], compare: (a: T, b: T) => number): { removed: T[]; added: T[] } {
    const splices = sortedDiff(before, after, compare);
    const removed: T[] = [];
    const added: T[] = [];

    for (const splice of splices) {
        removed.push(...before.slice(splice.start, splice.start + splice.deleteCount));
        added.push(...splice.toInsert);
    }

    return { removed, added };
}

/**
 * Returns the top N elements from the array.
 *
 * Faster than sorting the entire array when the array is a lot larger than N.
 *
 * @param array The unsorted array.
 * @param compare A sort function for the elements.
 * @param n The number of elements to return.
 * @return The first n elemnts from array when sorted with compare.
 */
export function top<T>(array: T[], compare: (a: T, b: T) => number, n: number): T[] {
    if (n === 0) {
        return [];
    }
    const result = array.slice(0, n).sort(compare);
    topStep(array, compare, result, n, array.length);
    return result;
}

function topStep<T>(array: T[], compare: (a: T, b: T) => number, result: T[], i: number, m: number): void {
    for (const n = result.length; i < m; i += 1) {
        const element = array[i];
        if (compare(element, result[n - 1]) < 0) {
            result.pop();
            const j = findFirst(result, (e) => compare(element, e) < 0);
            result.splice(j, 0, element);
        }
    }
}

/**
 * @returns a new array with all undefined or null values removed. The original array is not modified at all.
 */
export function coalesce<T>(array: T[]): T[] {
    if (!array) {
        return array;
    }

    return array.filter((e) => !!e);
}

/**
 * Moves the element in the array for the provided positions.
 */
export function move(array: unknown[], from: number, to: number): void {
    array.splice(to, 0, array.splice(from, 1)[0]);
}

/**
 * @returns {{false}} if the provided object is an array
 * 	and not empty.
 */
export function isFalsyOrEmpty(obj: unknown): boolean {
    return !Array.isArray(obj) || (<Array<unknown>>obj).length === 0;
}

/**
 * Removes duplicates from the given array. The optional keyFn allows to specify
 * how elements are checked for equalness by returning a unique string for each.
 */
export function distinct<T>(array: T[], keyFn?: (t: T) => string): T[] {
    if (!keyFn) {
        return array.filter((element, position) => array.indexOf(element) === position);
    }

    const seen: Record<string, boolean> = Object.create(null);
    return array.filter((elem) => {
        const key = keyFn(elem);
        if (seen[key]) {
            return false;
        }

        seen[key] = true;

        return true;
    });
}

export function uniqueFilter<T>(keyFn: (t: T) => string): (t: T) => boolean {
    const seen: Record<string, boolean> = Object.create(null);

    return (element) => {
        const key = keyFn(element);

        if (seen[key]) {
            return false;
        }

        seen[key] = true;
        return true;
    };
}

export function firstIndex<T>(array: T[], fn: (item: T) => boolean): number {
    for (let i = 0; i < array.length; i += 1) {
        const element = array[i];

        if (fn(element)) {
            return i;
        }
    }

    return -1;
}

export function first<T>(array: T[], fn: (item: T) => boolean, notFoundValue: T | null = null): T {
    const idx = firstIndex(array, fn);
    return idx < 0 && notFoundValue !== null ? notFoundValue : array[idx];
}

export function commonPrefixLength<T>(one: T[], other: T[], eqls: (a: T, b: T) => boolean = (a, b) => a === b): number {
    let result = 0;

    for (let i = 0, len = Math.min(one.length, other.length); i < len && eqls(one[i], other[i]); i += 1) {
        result += 1;
    }

    return result;
}

export function flatten<T>(arr: T[][]): T[] {
    return ([] as T[]).concat(...arr);
}

export function range(to: number): number[];
export function range(from: number, to: number): number[];
export function range(arg: number, to?: number): number[] {
    let from = typeof to === 'number' ? arg : 0;

    if (typeof to === 'number') {
        from = arg;
    } else {
        from = 0;
        to = arg;
    }

    const result: number[] = [];

    if (from <= to) {
        for (let i = from; i < to; i += 1) {
            result.push(i);
        }
    } else {
        for (let i = from; i > to; i -= 1) {
            result.push(i);
        }
    }

    return result;
}

export function fill<T>(num: number, valueFn: () => T, arr: T[] = []): T[] {
    for (let i = 0; i < num; i += 1) {
        arr[i] = valueFn();
    }

    return arr;
}

export function index<T>(array: T[], indexer: (t: T) => string): Record<string, T>;
export function index<T, R>(array: T[], indexer: (t: T) => string, merger?: (t: T, r: R) => R): Record<string, R>;
export function index<T, R>(
    array: T[],
    indexer: (t: T) => string,
    merger: (t: T, r: R) => R = (t) => (t as unknown) as R,
): Record<string, R> {
    return array.reduce((r, t) => {
        const key = indexer(t);
        r[key] = merger(t, r[key]);
        return r;
    }, Object.create(null));
}

/**
 * Inserts an element into an array. Returns a function which, when
 * called, will remove that element from the array.
 */
export function insert<T>(array: T[], element: T): () => void {
    array.push(element);

    return () => {
        const idx = array.indexOf(element);
        if (idx > -1) {
            array.splice(idx, 1);
        }
    };
}

/**
 * Insert `insertArr` inside `target` at `insertIndex`.
 * Please don't touch unless you understand https://jsperf.com/inserting-an-array-within-an-array
 */
export function arrayInsert<T>(target: T[], insertIndex: number, insertArr: T[]): T[] {
    const before = target.slice(0, insertIndex);
    const after = target.slice(insertIndex);
    return before.concat(insertArr, after);
}
