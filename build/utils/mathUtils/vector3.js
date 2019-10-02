export function clone(a) {
    return a.slice();
}
export function add(a, b) {
    a[0] += b[0];
    a[1] += b[1];
    a[2] += b[2];
    return a;
}
export function sub(a, b) {
    a[0] -= b[0];
    a[1] -= b[1];
    a[2] -= b[2];
    return a;
}
export function multiplyScalar(a, scalar) {
    a[0] *= scalar;
    a[1] *= scalar;
    a[2] *= scalar;
    return a;
}
export function lengthSq(a) {
    return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}
export function length(a) {
    return Math.sqrt(lengthSq(a));
}
export function normalize(a) {
    const l = length(a);
    multiplyScalar(a, 1 / l);
    return a;
}
export function negate(a) {
    a[0] = -a[0];
    a[1] = -a[1];
    a[2] = -a[2];
    return a;
}
export function cross(a, b, out = [0, 0, 0]) {
    out[0] = a[1] * b[2] - a[2] * b[1];
    out[1] = a[2] * b[0] - a[0] * b[2];
    out[2] = a[0] * b[1] - a[1] * b[0];
    return out;
}
export function applyMatrix(v, m) {
    const vc = clone(v);
    v[0] = vc[0] * m[0] + vc[1] * m[4] + vc[2] * m[8] + m[12];
    v[1] = vc[0] * m[1] + vc[1] * m[5] + vc[2] * m[9] + m[13];
    v[2] = vc[0] * m[2] + vc[1] * m[6] + vc[2] * m[10] + m[14];
    return v;
}
//# sourceMappingURL=vector3.js.map