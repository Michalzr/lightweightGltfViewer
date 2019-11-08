import * as Vec3Math from "./vector3.js";
import * as QuaternionMath from "./quaternion.js";
import * as Mat3Math from "./matrix3.js";

export type Mat4 = [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
];

export function create(): Mat4 {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function clone(a: Mat4): Mat4 {
    return a.slice() as Mat4;
}

// creates an orthographic projection matrix
export function ortho(xMag: number, yMag: number, near: number, far: number, out: Mat4 = create()): Mat4 {
    out[0] = 1 / xMag;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1 / yMag;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 2 / (near - far);
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = (far + near) / (near - far);
    out[15] = 1;
    return out;
}

// creates a perspective projection matrix
export function perspective(fovy: number, aspect: number, near: number, far: number, out: Mat4 = create()): Mat4 {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = 2 * far * near * nf;
    out[15] = 0;
    return out;
}

export function multiply(a: Mat4, b: Mat4, out: Mat4 = create()): Mat4 {
    out[0] = b[0] * a[0] + b[1] * a[4] + b[2] * a[8] + b[3] * a[12];
    out[1] = b[0] * a[1] + b[1] * a[5] + b[2] * a[9] + b[3] * a[13];
    out[2] = b[0] * a[2] + b[1] * a[6] + b[2] * a[10] + b[3] * a[14];
    out[3] = b[0] * a[3] + b[1] * a[7] + b[2] * a[11] + b[3] * a[15];

    out[4] = b[4] * a[0] + b[5] * a[4] + b[6] * a[8] + b[7] * a[12];
    out[5] = b[4] * a[1] + b[5] * a[5] + b[6] * a[9] + b[7] * a[13];
    out[6] = b[4] * a[2] + b[5] * a[6] + b[6] * a[10] + b[7] * a[14];
    out[7] = b[4] * a[3] + b[5] * a[7] + b[6] * a[11] + b[7] * a[15];

    out[8] = b[8] * a[0] + b[9] * a[4] + b[10] * a[8] + b[11] * a[12];
    out[9] = b[8] * a[1] + b[9] * a[5] + b[10] * a[9] + b[11] * a[13];
    out[10] = b[8] * a[2] + b[9] * a[6] + b[10] * a[10] + b[11] * a[14];
    out[11] = b[8] * a[3] + b[9] * a[7] + b[10] * a[11] + b[11] * a[15];

    out[12] = b[12] * a[0] + b[13] * a[4] + b[14] * a[8] + b[15] * a[12];
    out[13] = b[12] * a[1] + b[13] * a[5] + b[14] * a[9] + b[15] * a[13];
    out[14] = b[12] * a[2] + b[13] * a[6] + b[14] * a[10] + b[15] * a[14];
    out[15] = b[12] * a[3] + b[13] * a[7] + b[14] * a[11] + b[15] * a[15];
    return out;
}

// Sets translation component of out matrix
export function setTranslation(out: Mat4, v: Vec3Math.Vec3): Mat4 {
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    return out;
}

// Creates a matrix from a vector translation, quaternion rotation and vector scale
export function fromTranslationRotationScale(v: Vec3Math.Vec3, q: QuaternionMath.Quaternion, s: Vec3Math.Vec3, out: Mat4 = create()) {
    // Quaternion math
    const x = q[0],
        y = q[1],
        z = q[2],
        w = q[3];
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;

    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    const sx = s[0];
    const sy = s[1];
    const sz = s[2];

    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0;
    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[7] = 0;
    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    out[15] = 1;

    return out;
}

// Inverts a mat4
export function invert(a: Mat4, out: Mat4 = create()): Mat4 {
    const b00 = a[0] * a[5] - a[1] * a[4];
    const b01 = a[0] * a[6] - a[2] * a[4];
    const b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5];
    const b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12];
    const b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13];
    const b10 = a[9] * a[15] - a[11] * a[13];
    const b11 = a[10] * a[15] - a[11] * a[14];

    // Calculate the determinant
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) {
        return null;
    }
    det = 1.0 / det;

    out[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    out[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    out[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    out[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    out[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    out[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    out[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    out[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    out[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    out[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    out[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    out[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    out[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    out[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    out[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    out[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;

    return out;
}

// Transpose the values of a mat4
export function transpose(a: Mat4, out: Mat4 = create()): Mat4 {
    out[0] = a[0];
    out[1] = a[4];
    out[2] = a[8];
    out[3] = a[12];
    out[4] = a[1];
    out[5] = a[5];
    out[6] = a[9];
    out[7] = a[13];
    out[8] = a[2];
    out[9] = a[6];
    out[10] = a[10];
    out[11] = a[14];
    out[12] = a[3];
    out[13] = a[7];
    out[14] = a[11];
    out[15] = a[15];

    return out;
}

export function lookAt(eye: Vec3Math.Vec3, target: Vec3Math.Vec3, up: Vec3Math.Vec3, out: Mat4 = create()): Mat4 {
    const z = Vec3Math.sub(Vec3Math.clone(eye), target);

    if (Vec3Math.lengthSq(z) === 0) {
        // eye and target are in the same position
        z[2] = 1;
    }

    Vec3Math.normalize(z);
    const x = Vec3Math.cross(up, z);

    if (Vec3Math.lengthSq(x) === 0) {
        // up and z are parallel
        if (Math.abs(up[2]) === 1) {
            z[0] += 0.0001;

        } else {
            z[2] += 0.0001;
        }

        Vec3Math.normalize(z);
        Vec3Math.cross(up, z, x);
    }

    Vec3Math.normalize(x);
    const y = Vec3Math.cross(z, x);

    out[0] = x[0]; out[4] = y[0]; out[8] = z[0];
    out[1] = x[1]; out[5] = y[1]; out[9] = z[1];
    out[2] = x[2]; out[6] = y[2]; out[10] = z[2];

    return out;
};

export function getSubMatrix3(a: Mat4, out: Mat3Math.Mat3 = Mat3Math.create()): Mat3Math.Mat3 {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[4];
    out[4] = a[5];
    out[5] = a[6];
    out[6] = a[8];
    out[7] = a[9];
    out[8] = a[10];

    return out;
}