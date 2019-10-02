import * as Mat4Math from "./utils/mathUtils/martix4.js";
export class Renderer {
    constructor(canvas) {
        this.glShaders = new Map();
        this.dataViewToWebGLBuffer = new Map();
        this.gl = canvas.getContext("webgl");
        if (this.gl === null) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return;
        }
    }
    setGltf(loadedGltf) {
        this.gltf = loadedGltf;
    }
    initShader(id, vertexSource, fragmentSource) {
        const vertexShader = this.loadShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.loadShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        const shaderProgram = this.gl.createProgram();
        this.gl.attachShader(shaderProgram, vertexShader);
        this.gl.attachShader(shaderProgram, fragmentShader);
        this.gl.linkProgram(shaderProgram);
        if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
            alert(`An error occured while linking shader: ` + this.gl.getProgramInfoLog(shaderProgram));
            return null;
        }
        const shaderInfo = {
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
    render(viewMatrix) {
        const fieldOfView = 45 * Math.PI / 180;
        const aspect = this.gl.canvas.clientWidth / this.gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 100.0;
        const projectionMatrix = Mat4Math.perspective(fieldOfView, aspect, zNear, zFar);
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clearDepth(1.0);
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.depthFunc(this.gl.LEQUAL);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        if (!this.gltf) {
            return;
        }
        this.gltf.nodes.forEach(node => {
            this.renderNode(node, viewMatrix, projectionMatrix);
        });
    }
    renderNode(node, viewMatrix, projectionMatrix) {
        if (node.hasOwnProperty("children")) {
            node.children.forEach(chIdx => {
                this.renderNode(this.gltf.nodes[chIdx], viewMatrix, projectionMatrix);
            });
        }
        if (!node.hasOwnProperty("mesh")) {
            return;
        }
        const meshPrimitives = this.gltf.meshes[node.mesh].primitives;
        const shaderInfo = this.glShaders.values().next().value;
        meshPrimitives.forEach(meshPrimitive => {
            for (let attribute in meshPrimitive.attributes) {
                if (!shaderInfo.attribLocations.hasOwnProperty(attribute)) {
                    continue;
                }
                const accessor = this.gltf.accessors[meshPrimitive.attributes[attribute]];
                let buffer = this.dataViewToWebGLBuffer.get(accessor.bufferView);
                if (!buffer) {
                    buffer = this.gl.createBuffer();
                    this.dataViewToWebGLBuffer.set(accessor.bufferView, buffer);
                    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
                    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.gltf.dataViews[accessor.bufferView], this.gl.STATIC_DRAW);
                }
                else {
                    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
                }
                const attribLocation = shaderInfo.attribLocations[attribute];
                this.gl.vertexAttribPointer(attribLocation, Renderer.NUMBER_OF_COMPONENTS.get(accessor.type), accessor.componentType, accessor.normalized, accessor.byteStride, accessor.byteOffset);
                this.gl.enableVertexAttribArray(attribLocation);
                this.gl.useProgram(shaderInfo.program);
                const modelMatrix = node.matrix;
                const inverseModelMatrix = Mat4Math.invert(modelMatrix);
                const transposedInversedModeMatrix = Mat4Math.transpose(inverseModelMatrix);
                const modelMatrixForNormal = Mat4Math.getSubMatrix3(transposedInversedModeMatrix);
                this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.viewMatrix, false, viewMatrix);
                this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
                this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.modelMatrix, false, modelMatrix);
                this.gl.uniformMatrix3fv(shaderInfo.uniformLocations.modelMatrixForNormal, false, modelMatrixForNormal);
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            }
        });
    }
    loadShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            alert(`An error occured compiling the shader: ` + this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }
}
Renderer.NUMBER_OF_COMPONENTS = new Map([
    ["SCALAR", 1],
    ["VEC2", 2],
    ["VEC3", 3],
    ["VEC4", 4],
    ["MAT2", 4],
    ["MAT3", 9],
    ["MAT4", 16]
]);
//# sourceMappingURL=renderer.js.map