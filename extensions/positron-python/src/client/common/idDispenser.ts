export class IdDispenser {
    private _freedInts: number[] = [];
    private _curValue: number = 0;

    public Allocate(): number {
        if (this._freedInts.length > 0) {
            let res: number = this._freedInts[this._freedInts.length - 1];
            this._freedInts.splice(this._freedInts.length - 1, 1);
            return res;
        } else {
            let res: number = this._curValue++;
            return res;
        }
    }

    public Free(id: number) {
        if (id + 1 === this._curValue) {
            this._curValue--;
        } else {
            this._freedInts.push(id);
        }
    }
}