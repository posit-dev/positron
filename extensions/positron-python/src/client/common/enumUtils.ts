export class EnumEx {
    static getNamesAndValues<T extends number>(e: any) {
        return EnumEx.getNames(e).map(n => ({ name: n, value: e[n] as T }));
    }

    static getNames(e: any) {
        return EnumEx.getObjValues(e).filter(v => typeof v === "string") as string[];
    }

    static getValues<T extends number>(e: any) {
        return EnumEx.getObjValues(e).filter(v => typeof v === "number") as T[];
    }

    private static getObjValues(e: any): (number | string)[] {
        return Object.keys(e).map(k => e[k]);
    }
}
