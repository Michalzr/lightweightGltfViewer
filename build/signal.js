export class Signal {
    constructor() {
        this._slots = [];
    }
    connect(callback, object) {
        if (typeof callback !== "function") {
            return;
        }
        if (object) {
            this._slots.push({ callback: callback, object: object });
        }
        else {
            this._slots.push({ callback: callback });
        }
    }
    disconnect(callback, object) {
        this._slots = this._slots.filter(slot => {
            return (object === undefined) ?
                (slot.callback !== callback) :
                (slot.callback !== callback) || (slot.object !== object);
        });
    }
    disconnectAll() {
        this._slots = [];
    }
    emit(data) {
        this._slots.forEach(slot => {
            const object = slot.object;
            if (object) {
                slot.callback.call(object, data);
            }
            else {
                slot.callback(data);
            }
        });
    }
}
//# sourceMappingURL=signal.js.map