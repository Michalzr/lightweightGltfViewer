export type Quaternion = [number, number, number, number];

export function create(): Quaternion {
    return [0, 0, 0, 1];
}

export function clone(q: Quaternion): Quaternion {
    return q.slice() as Quaternion;
}