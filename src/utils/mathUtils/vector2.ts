export type Vec2 = [number, number];

export function clone(a: Vec2): Vec2 {
    return a.slice() as Vec2;
}

export function copy(a: Vec2, b: Vec2): Vec2 {
    a[0] = b[0];
    a[1] = b[1];
    return a as Vec2;
}

export function add(a: Vec2, b: Vec2): Vec2 {
    a[0] += b[0];
    a[1] += b[1];
    return a;
}

export function sub(a: Vec2, b: Vec2): Vec2 {
    a[0] -= b[0];
    a[1] -= b[1];
    return a;
}

export function multiplyScalar(a: Vec2, scalar: number): Vec2 {
    a[0] *= scalar;
    a[1] *= scalar;
    return a;
}

export function lengthSq(a: Vec2): number {
    return a[0] * a[0] + a[1] * a[1];
}

export function length(a: Vec2): number {
    return Math.sqrt(lengthSq(a));
}

export function normalize(a: Vec2): void {
    const l = length(a);
    multiplyScalar(a, 1 / l);
}

export function negate(a: Vec2): Vec2 {
    a[0] = - a[0];
    a[1] = - a[1];
    return a;
}

export function lerp(a: Vec2, b: Vec2, t: number, out: Vec2 = [0, 0]): Vec2 {
    copy(out, a);
    const bClone = clone(b);

    multiplyScalar(out, 1 - t);
    multiplyScalar(bClone, t);
    add(out, bClone);

    return out;
}