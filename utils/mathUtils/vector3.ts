import * as Mat4Math from "./martix4.js";

export type Vec3 = [number, number, number];

export function clone(a: Vec3): Vec3 {
    return a.slice() as Vec3;
}

export function add(a: Vec3, b: Vec3): Vec3 {
    a[0] += b[0];
    a[1] += b[1];
    a[2] += b[2];
    return a;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
    a[0] -= b[0];
    a[1] -= b[1];
    a[2] -= b[2];
    return a;
}

export function multiplyScalar(a: Vec3, scalar: number): Vec3 {
    a[0] *= scalar;
    a[1] *= scalar;
    a[2] *= scalar;
    return a;
}

export function lengthSq(a: Vec3): number {
    return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

export function length(a: Vec3): number {
    return Math.sqrt(lengthSq(a));
}

export function normalize(a: Vec3): Vec3 {
    const l = length(a);
    multiplyScalar(a, 1 / l);
    return a;
}

export function negate(a: Vec3): Vec3 {
    a[0] = - a[0];
    a[1] = - a[1];
    a[2] = - a[2];
    return a;
}

export function cross(a: Vec3, b: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
    out[0] = a[1] * b[2] - a[2] * b[1];
    out[1] = a[2] * b[0] - a[0] * b[2];
    out[2] = a[0] * b[1] - a[1] * b[0];

    return out;
}

export function applyMatrix(v: Vec3, m: Mat4Math.Mat4): Vec3 {
    const vc = clone(v);
    v[0] = vc[0] * m[0] + vc[1] * m[4] + vc[2] * m[8] + m[12];
    v[1] = vc[0] * m[1] + vc[1] * m[5] + vc[2] * m[9] + m[13];
    v[2] = vc[0] * m[2] + vc[1] * m[6] + vc[2] * m[10] + m[14];

    return v;
}