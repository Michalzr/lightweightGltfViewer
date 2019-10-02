export function clone(a) {
    return a.slice();
}
export function add(a, b) {
    a[0] += b[0];
    a[1] += b[1];
    return a;
}
export function sub(a, b) {
    a[0] -= b[0];
    a[1] -= b[1];
    return a;
}
export function multiplyScalar(a, scalar) {
    a[0] *= scalar;
    a[1] *= scalar;
    return a;
}
export function lengthSq(a) {
    return a[0] * a[0] + a[1] * a[1];
}
export function length(a) {
    return Math.sqrt(lengthSq(a));
}
export function normalize(a) {
    const l = length(a);
    multiplyScalar(a, 1 / l);
}
export function negate(a) {
    a[0] = -a[0];
    a[1] = -a[1];
    return a;
}
//# sourceMappingURL=vector2.js.map