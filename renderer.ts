import * as Mat4Math from "./utils/mathUtils/martix4.js";
import { LoadedGltf } from "./gltfLoader.js"
import * as GlTf from "./gltfInterface.js";


const vertexShaderSource = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 texcoord0;

uniform mat4 modelMatrix;
uniform mat3 modelMatrixForNormal;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

varying vec3 vNormal;
varying vec2 vTextureCoord;

void main() {
    vNormal = normalize(mat3(viewMatrix) * modelMatrixForNormal * normal);
    vTextureCoord = texcoord0;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position.xyz, 1);
}
`;

const fragmentShaderSource = `
precision mediump float;

uniform sampler2D colorSampler;

varying vec3 vNormal;
varying vec2 vTextureCoord;

void main() {
    vec4 texColor = texture2D(colorSampler, vTextureCoord);
    float intensity = max(0.0, abs(dot(vNormal, vec3(0.0, 0.0, 1.0))));
    gl_FragColor = vec4(texColor.xyz * intensity, texColor.w);
}
`;

interface ShaderInfo {
    program: WebGLProgram,
    attribLocations: {
        POSITION: GLint,
        NORMAL: GLint,
        TEXCOORD_0: GLint
    },
    uniformLocations: {
        colorSampler: WebGLUniformLocation,
        viewMatrix: WebGLUniformLocation,
        projectionMatrix: WebGLUniformLocation,
        modelMatrix: WebGLUniformLocation,
        modelMatrixForNormal: WebGLUniformLocation,
    },
}

export class Renderer {
    private static readonly NUMBER_OF_COMPONENTS: Map<string, number> = new Map([
        ["SCALAR", 1],
        ["VEC2", 2],
        ["VEC3", 3],
        ["VEC4", 4],
        ["MAT2", 4],
        ["MAT3", 9],
        ["MAT4", 16]
    ]);

    private gl: WebGLRenderingContext;
    private pbrShaderInfo: ShaderInfo;

    private gltf: LoadedGltf;
    private dataViewToWebGLBuffer = new Map<number, WebGLBuffer>();
    private textureToWebGLTexture = new Map<number, WebGLTexture>();

    constructor(canvas: HTMLCanvasElement) {
        // Initialize the GL context
        this.gl = canvas.getContext("webgl");

        // Only continue if WebGL is available and working
        if (this.gl === null) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return;
        }

        // Allow UNSIGNED_INT extension
        this.gl.getExtension("OES_element_index_uint");

        // init shader
        this.pbrShaderInfo = this.initShader(vertexShaderSource, fragmentShaderSource);
    }

    deleteBuffersAndTextures(): void {
        this.dataViewToWebGLBuffer.forEach((webGLBuffer, dataViewIdx) => {
            this.gl.deleteBuffer(webGLBuffer);
        });
        this.dataViewToWebGLBuffer.clear();
        
        this.textureToWebGLTexture.forEach((WebGLTexture, dataViewIdx) => {
            this.gl.deleteTexture(WebGLTexture);
        });
        this.textureToWebGLTexture.clear();
    }

    setGltf(loadedGltf: LoadedGltf): void {
        this.deleteBuffersAndTextures();
        this.gltf = loadedGltf;
    }

    render(viewMatrix: Mat4Math.Mat4) {
        // update projectionmatrix
        const fieldOfView = 45 * Math.PI / 180;   // in radians
        const aspect = this.gl.canvas.clientWidth / this.gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 100.0;
        const projectionMatrix = Mat4Math.perspective(fieldOfView, aspect, zNear, zFar);


        // clear canvas
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clearDepth(1.0);
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.depthFunc(this.gl.LEQUAL);

        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

        if (!this.gltf) {
            return;
        }

        this.gltf.rootNodeIds.forEach(nodeId => {
            this.renderNode(this.gltf.nodes[nodeId], Mat4Math.create(), viewMatrix, projectionMatrix);
        });
    }

    private renderNode(node: GlTf.Node, parentModelMatrix: Mat4Math.Mat4, viewMatrix: Mat4Math.Mat4, projectionMatrix: Mat4Math.Mat4): void {
        const modelMatrix = Mat4Math.multiply(parentModelMatrix, node.matrix as Mat4Math.Mat4);

        if (node.hasOwnProperty("children")) {
            node.children.forEach(chIdx => {
                this.renderNode(this.gltf.nodes[chIdx], modelMatrix, viewMatrix, projectionMatrix);
            });
        }

        if (!node.hasOwnProperty("mesh")) {
            return;
        }

        const meshPrimitives = this.gltf.meshes[node.mesh].primitives;
        meshPrimitives.forEach(meshPrimitive => {
            this.renderMeshPrimitive(meshPrimitive, modelMatrix, viewMatrix, projectionMatrix);
        });
    }

    private renderMeshPrimitive(meshPrimitive: GlTf.MeshPrimitive, modelMatrix: Mat4Math.Mat4, viewMatrix: Mat4Math.Mat4, projectionMatrix: Mat4Math.Mat4): void {
        // resolve indices
        const indexAccessor = this.gltf.accessors[meshPrimitive.indices];
        if (indexAccessor) {
            let buffer = this.dataViewToWebGLBuffer.get(indexAccessor.bufferView);

            if (!buffer) {
                buffer = this.gl.createBuffer();
                this.dataViewToWebGLBuffer.set(indexAccessor.bufferView, buffer);

                this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buffer);
                this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.gltf.dataViews[indexAccessor.bufferView], this.gl.STATIC_DRAW);

            } else {
                this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buffer);
            }
        }

        // resolve attributes
        let vertexCount = 0;
        for (let attribute in meshPrimitive.attributes) {
            if (!this.pbrShaderInfo.attribLocations.hasOwnProperty(attribute)) {
                continue;
            }

            const accessor = this.gltf.accessors[meshPrimitive.attributes[attribute]];
            let buffer = this.dataViewToWebGLBuffer.get(accessor.bufferView);

            vertexCount = accessor.count;

            if (!buffer) {
                // buffer is being used for the first time, initialize
                buffer = this.gl.createBuffer();
                this.dataViewToWebGLBuffer.set(accessor.bufferView, buffer);

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
                this.gl.bufferData(this.gl.ARRAY_BUFFER, this.gltf.dataViews[accessor.bufferView], this.gl.STATIC_DRAW);

            } else {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer)
            }

            const attribLocation = (this.pbrShaderInfo.attribLocations as any)[attribute]; // TODO: fix typing
            this.gl.vertexAttribPointer(
                attribLocation,
                Renderer.NUMBER_OF_COMPONENTS.get(accessor.type),
                accessor.componentType,
                accessor.normalized,
                accessor.byteStride,
                accessor.byteOffset
            );
            this.gl.enableVertexAttribArray(attribLocation);
        }

        if (vertexCount > 0) {
            this.gl.useProgram(this.pbrShaderInfo.program); // if we really keep using only one shader, we can move this to initShader

            const inverseModelMatrix = Mat4Math.invert(modelMatrix);
            const transposedInversedModeMatrix = Mat4Math.transpose(inverseModelMatrix);
            const modelMatrixForNormal = Mat4Math.getSubMatrix3(transposedInversedModeMatrix);

            this.gl.uniformMatrix4fv(this.pbrShaderInfo.uniformLocations.viewMatrix, false, viewMatrix);
            this.gl.uniformMatrix4fv(this.pbrShaderInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
            this.gl.uniformMatrix4fv(this.pbrShaderInfo.uniformLocations.modelMatrix, false, modelMatrix);
            this.gl.uniformMatrix3fv(this.pbrShaderInfo.uniformLocations.modelMatrixForNormal, false, modelMatrixForNormal);

            const renderMode = meshPrimitive.mode === undefined ? this.gl.TRIANGLES : meshPrimitive.mode;

            if (meshPrimitive.hasOwnProperty("material")) {
                this.setMaterialUniforms(this.gltf.materials[meshPrimitive.material]);
            }

            if (indexAccessor) {
                this.gl.drawElements(renderMode, indexAccessor.count, indexAccessor.componentType, indexAccessor.byteOffset);
            } else {
                this.gl.drawArrays(renderMode, 0, vertexCount);
            }
        }
    }

    private setMaterialUniforms(material: GlTf.Material): void {
        // set culling based on "doubleSided" property
        if (material.doubleSided) {
            this.gl.disable(this.gl.CULL_FACE);
        } else {
            this.gl.enable(this.gl.CULL_FACE);
            this.gl.cullFace(this.gl.BACK);
        }

        // set blending based on alpha mode
        // TODO: imeplement "MASK" with alpha cutoff
        // TODO: also implement ordering opaque objects based on distance from camera
        if (material.alphaMode === "BLEND") {
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
        } else {
            this.gl.disable(this.gl.BLEND);
        }

        if (material.pbrMetallicRoughness) {
            if (material.pbrMetallicRoughness.hasOwnProperty("baseColorTexture")) {
                const textureIdx = material.pbrMetallicRoughness.baseColorTexture.index;
                let webGLColorTexture = this.textureToWebGLTexture.get(textureIdx);

                if (!webGLColorTexture) {
                    // initializing texture
                    webGLColorTexture = this.gl.createTexture();
                    this.textureToWebGLTexture.set(textureIdx, webGLColorTexture);

                    const image = this.gltf.images[this.gltf.textures[textureIdx].source];

                    this.gl.bindTexture(this.gl.TEXTURE_2D, webGLColorTexture);
                    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
                    this.gl.generateMipmap(this.gl.TEXTURE_2D);

                } else {
                    this.gl.bindTexture(this.gl.TEXTURE_2D, webGLColorTexture);
                }
            }
        }
    }

    private initShader(vertexSource: string, fragmentSource: string): ShaderInfo {
        const vertexShader = this.loadShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.loadShader(this.gl.FRAGMENT_SHADER, fragmentSource);

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
                TEXCOORD_0: this.gl.getAttribLocation(shaderProgram, 'texcoord0'),
            },
            uniformLocations: {
                viewMatrix: this.gl.getUniformLocation(shaderProgram, 'viewMatrix'),
                projectionMatrix: this.gl.getUniformLocation(shaderProgram, 'projectionMatrix'),
                modelMatrix: this.gl.getUniformLocation(shaderProgram, 'modelMatrix'),
                modelMatrixForNormal: this.gl.getUniformLocation(shaderProgram, 'modelMatrixForNormal'),
                colorSampler: this.gl.getUniformLocation(shaderProgram, "colorSampler")
            },
        };

        return shaderInfo;
    }

    private loadShader(type: number /*vertex or fragment*/, source: string) {
        const shader = this.gl.createShader(type);

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