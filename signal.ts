/**
 * Signal-Slot pattern module
 */

type SlotCallback<T> = (data?: T) => void;

interface Slot<T> {
    callback: SlotCallback<T>;
    object?: any;
}

export class Signal<T> {
    private _slots: Slot<T>[] = [];

    connect(callback: (data?: T) => void, object?: Object): void {
        if (typeof callback !== "function") {
            return;
        }
        if (object) {
            this._slots.push({ callback: callback, object: object });
        } else {
            this._slots.push({ callback: callback });
        }
    }

    disconnect(callback: (data?: T) => void, object?: Object): void {
        this._slots = this._slots.filter(slot => {
            return (object === undefined) ?
                (slot.callback !== callback) :
                (slot.callback !== callback) || (slot.object !== object);
        });
    }

    disconnectAll(): void {
        this._slots = [];
    }

    emit(data?: T): void {
        this._slots.forEach(slot => {
            const object: Object = slot.object;
            if (object) {
                slot.callback.call(object, data);
            } else {
                slot.callback(data);
            }
        });
    }
}
