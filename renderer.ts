import * as Mat4Math from "./utils/mathUtils/martix4.js";
import { LoadedGltf } from "./gltfLoader.js"
import * as GlTf from "./gltfInterface.js";


interface ShaderInfo {
    program: WebGLProgram,
    attribLocations: {
        POSITION: GLint,
        NORMAL: GLint,
    },
    uniformLocations: {
        viewMatrix: WebGLUniformLocation,
        projectionMatrix: WebGLUniformLocation,
        modelMatrix: WebGLUniformLocation,
        modelMatrixForNormal: WebGLUniformLocation,
    },
}

export class Renderer {

    // TODO: figure out a better place for this
    static NUMBER_OF_COMPONENTS: Map<string, number> = new Map([
        ["SCALAR", 1],
        ["VEC2", 2],
        ["VEC3", 3],
        ["VEC4", 4],
        ["MAT2", 4],
        ["MAT3", 9],
        ["MAT4", 16]
    ]);


    private gl: WebGLRenderingContext;
    private glShaders = new Map<string, ShaderInfo>();

    private gltf: LoadedGltf;
    private dataViewToWebGLBuffer = new Map<number, WebGLBuffer>();

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
    }

    setGltf(loadedGltf: LoadedGltf): void {
        this.gltf = loadedGltf;
    }

    initShader(id: string, vertexSource: string, fragmentSource: string): void {
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
            },
            uniformLocations: {
                viewMatrix: this.gl.getUniformLocation(shaderProgram, 'viewMatrix'),
                projectionMatrix: this.gl.getUniformLocation(shaderProgram, 'projectionMatrix'),
                modelMatrix: this.gl.getUniformLocation(shaderProgram, 'modelMatrix'),
                modelMatrixForNormal: this.gl.getUniformLocation(shaderProgram, 'modelMatrixForNormal')
            },
        };

        this.glShaders.set(id, shaderInfo);
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

    renderNode(node: GlTf.Node, parentModelMatrix: Mat4Math.Mat4, viewMatrix: Mat4Math.Mat4, projectionMatrix: Mat4Math.Mat4): void {
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


        // TODO: materials
        // now we just use first shader..
        const shaderInfo: ShaderInfo = this.glShaders.values().next().value;


        meshPrimitives.forEach(meshPrimitive => {
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
                if (!shaderInfo.attribLocations.hasOwnProperty(attribute)) {
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

                const attribLocation = (shaderInfo.attribLocations as any)[attribute]; // TODO: fix typing
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

            this.gl.useProgram(shaderInfo.program);

            const inverseModelMatrix = Mat4Math.invert(modelMatrix);
            const transposedInversedModeMatrix = Mat4Math.transpose(inverseModelMatrix);
            const modelMatrixForNormal = Mat4Math.getSubMatrix3(transposedInversedModeMatrix);

            this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.viewMatrix, false, viewMatrix);
            this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
            this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.modelMatrix, false, modelMatrix);
            this.gl.uniformMatrix3fv(shaderInfo.uniformLocations.modelMatrixForNormal, false, modelMatrixForNormal);

            const renderMode = meshPrimitive.mode === undefined ? this.gl.TRIANGLES : meshPrimitive.mode;

            if (indexAccessor) {
                this.gl.drawElements(renderMode, indexAccessor.count, indexAccessor.componentType, indexAccessor.byteOffset);
            } else {
                this.gl.drawArrays(renderMode, 0, vertexCount);
            }
        });
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