
export type Mat3 = [
    number, number, number,
    number, number, number,
    number, number, number
];

export function create(): Mat3 {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function clone(a: Mat3): Mat3 {
    return a.slice() as Mat3;
}