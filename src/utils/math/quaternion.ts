export type Quaternion = [number, number, number, number];

export function create(): Quaternion {
    return [0, 0, 0, 1];
}

export function clone(q: Quaternion): Quaternion {
    return q.slice() as Quaternion;
}

export function copy(a: Quaternion, b: Quaternion): Quaternion {
    a[0] = b[0];
    a[1] = b[1];
    a[2] = b[2];
    a[3] = b[3];
    return a as Quaternion;
}

export function length(a: Quaternion): number {
    return Math.sqrt( a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3] );
}

export function normalize(a: Quaternion): Quaternion {
    var l = length(a);

    if ( l === 0 ) {
        a[0] = 0;
        a[1] = 0;
        a[2] = 0;
        a[3] = 1;

    } else {
        l = 1 / l;

        a[0] = a[0] * l;
        a[1] = a[1] * l;
        a[2] = a[2] * l;
        a[3] = a[3] * l;
    }

    return a;
}

export function slerp(a: Quaternion, b: Quaternion, t: number, out: Quaternion = [0, 0, 0, 1]): Quaternion {
    if (t === 0) return copy(out, a);
    if (t === 1) return copy(out, b);
    
    copy(out, a);

    var cosHalfTheta = out[3] * b[3] + out[0] * b[0] + out[1] * b[1] + out[2] * b[2];

    if ( cosHalfTheta < 0 ) {
        out[3] = - b[3];
        out[0] = - b[0];
        out[1] = - b[1];
        out[2] = - b[2];
        cosHalfTheta = - cosHalfTheta;

    } else {
        copy(out, b);
    }

    if ( cosHalfTheta >= 1.0 ) {
        copy(out, a);

        return out;
    }

    var sqrSinHalfTheta = 1.0 - cosHalfTheta * cosHalfTheta;

    if ( sqrSinHalfTheta <= Number.EPSILON ) {
        var s = 1 - t;
        out[3] = s * a[3] + t * out[3];
        out[0] = s * a[0] + t * out[0];
        out[1] = s * a[1] + t * out[1];
        out[2] = s * a[2] + t * out[2];

        return normalize(out);
    }

    var sinHalfTheta = Math.sqrt( sqrSinHalfTheta );
    var halfTheta = Math.atan2( sinHalfTheta, cosHalfTheta );
    var ratioA = Math.sin( ( 1 - t ) * halfTheta ) / sinHalfTheta,
        ratioB = Math.sin( t * halfTheta ) / sinHalfTheta;

    out[3] = ( a[3] * ratioA + out[3] * ratioB );
    out[0] = ( a[0] * ratioA + out[0] * ratioB );
    out[1] = ( a[1] * ratioA + out[1] * ratioB );
    out[2] = ( a[2] * ratioA + out[2] * ratioB );

    return out;
}