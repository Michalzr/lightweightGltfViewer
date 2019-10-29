const vertexShaderSource = `
attribute vec3 position;
attribute vec3 normal;
#ifdef HAS_UVS
    attribute vec2 texcoord0;
    attribute vec4 tangent;
#endif

uniform mat4 modelMatrix;
uniform mat3 modelMatrixForNormal;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

varying vec3 vNormal;
varying vec2 vTextureCoord;
#ifdef HAS_UVS
    varying mat3 TBN;
#endif

void main() {
    vTextureCoord = vec2(0,0);
    #ifdef HAS_UVS
        vTextureCoord = texcoord0;
        vNormal = normalize(mat3(viewMatrix) * modelMatrixForNormal * normal);

        vec3 bitangent = cross(normal, tangent.xyz) * tangent.w;
        vec3 T = normalize(modelMatrix * vec4(tangent.xyz, 0.0)).xyz;
        vec3 B = normalize(modelMatrix * vec4(bitangent, 0.0)).xyz;
        vec3 N = normalize(modelMatrixForNormal * normal);
        TBN = mat3(viewMatrix * modelMatrix) * mat3(T, B, N);
    #endif
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position.xyz, 1);
}
`;

const fragmentShaderSource = `
precision mediump float;

uniform vec4 color;
#ifdef HAS_BASE_COLOR_TEXTURE
    uniform sampler2D colorSampler;
#endif
#ifdef HAS_NORMAL_TEXTURE
    uniform sampler2D normalSampler;
#endif

varying vec3 vNormal;
varying vec2 vTextureCoord;
#ifdef HAS_NORMAL_TEXTURE
    varying mat3 TBN;
#endif

void main() {
    vec4 fragColor = color;
    #ifdef HAS_BASE_COLOR_TEXTURE
        fragColor = fragColor * texture2D(colorSampler, vTextureCoord);
    #endif

    vec3 normal = vNormal;
    #ifdef HAS_NORMAL_TEXTURE
        normal = texture2D(normalSampler, vTextureCoord).xyz;
        normal = TBN * normal;
        normal = normalize(normal);
    #endif

    float intensity = max(0.0, abs(dot(normal, vec3(0.0, 0.0, 1.0))));
    gl_FragColor = vec4(fragColor.xyz * intensity, fragColor.w);
}
`;

export interface ShaderInfo {
    program: WebGLProgram,
    attribLocations: {
        POSITION: GLint,
        NORMAL: GLint,
        TANGENT: GLint,
        TEXCOORD_0: GLint
    },
    uniformLocations: {
        color: WebGLUniformLocation,
        colorSampler: WebGLUniformLocation,
        normalSampler: WebGLUniformLocation,
        viewMatrix: WebGLUniformLocation,
        projectionMatrix: WebGLUniformLocation,
        modelMatrix: WebGLUniformLocation,
        modelMatrixForNormal: WebGLUniformLocation,
    },
}

export enum ShaderType {
    Vertex = "0",
    Fragment = "1"
}

export class ShaderCache {
    private gl: WebGLRenderingContext;
    private shaders = new Map<string, WebGLShader>();
    private programs = new Map<string, ShaderInfo>();

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
    }

    getShaderProgram(vertexDefines: string[], fragmentDefines: string[]): ShaderInfo {
        const key = vertexDefines.toString() + "&" + fragmentDefines.toString();

        let shaderProgram = this.programs.get(key);

        if (!shaderProgram) {
            shaderProgram = this.initShader(vertexDefines, fragmentDefines);
            this.programs.set(key, shaderProgram);
        }

        return shaderProgram;
    }

    private getShader(shaderType: ShaderType, defines: string[]): WebGLShader {
        const key = shaderType + "&" + defines.toString();
        let shader = this.shaders.get(key);

        if (!shader) {
            shader = this.loadShader(shaderType, defines);
            this.shaders.set(key, shader);
        }

        return shader;
    }

    private initShader(vertexDefines: string[], fragmentDefines: string[]): ShaderInfo {
        const vertexShader = this.getShader(ShaderType.Vertex, vertexDefines);
        const fragmentShader = this.getShader(ShaderType.Fragment, fragmentDefines);

        // create shader program
        const shaderProgram = this.gl.createProgram();
        this.gl.attachShader(shaderProgram, vertexShader);
        this.gl.attachShader(shaderProgram, fragmentShader);
        this.gl.linkProgram(shaderProgram);

        // notify if creation failed and return null
        if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
            alert(`An error occured while linking shader: ` + this.gl.getProgramInfoLog(shaderProgram));
            return null;
        }

        const shaderInfo: ShaderInfo = {
            program: shaderProgram,
            attribLocations: {
                POSITION: this.gl.getAttribLocation(shaderProgram, 'position'),
                NORMAL: this.gl.getAttribLocation(shaderProgram, 'normal'),
                TANGENT: this.gl.getAttribLocation(shaderProgram, 'tangent'),
                TEXCOORD_0: this.gl.getAttribLocation(shaderProgram, 'texcoord0'),
            },
            uniformLocations: {
                color: this.gl.getUniformLocation(shaderProgram, 'color'),
                viewMatrix: this.gl.getUniformLocation(shaderProgram, 'viewMatrix'),
                projectionMatrix: this.gl.getUniformLocation(shaderProgram, 'projectionMatrix'),
                modelMatrix: this.gl.getUniformLocation(shaderProgram, 'modelMatrix'),
                modelMatrixForNormal: this.gl.getUniformLocation(shaderProgram, 'modelMatrixForNormal'),
                colorSampler: this.gl.getUniformLocation(shaderProgram, "colorSampler"),
                normalSampler: this.gl.getUniformLocation(shaderProgram, "normalSampler")
            },
        };

        return shaderInfo;
    }

    private loadShader(type: ShaderType, defines: string[]): WebGLShader {
        const shader = this.gl.createShader((type === ShaderType.Vertex) ? this.gl.VERTEX_SHADER : this.gl.FRAGMENT_SHADER);

        // create source with defines
        let source = "";
        defines.forEach(define => {
            source += "#define " + define + "\n";
        });
        source += (type === ShaderType.Vertex) ? vertexShaderSource : fragmentShaderSource;

        // send the source to the shader object
        this.gl.shaderSource(shader, source);

        // compile the shader
        this.gl.compileShader(shader);

        // notify if compilation fails and return null
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            alert(`An error occured compiling the shader: ` + this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

}