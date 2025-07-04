import * as Mat4Math from "./utils/math/martix4";
import { LoadedGltf } from "./models/loadedGltf";
import * as GlTf from "./models/gltf";
import { ShaderCache, ShaderInfo } from "./shaderCache";
import { Animator } from "./animator";

export class Renderer {
  private static readonly NUMBER_OF_COMPONENTS: Map<string, number> = new Map([
    ["SCALAR", 1],
    ["VEC2", 2],
    ["VEC3", 3],
    ["VEC4", 4],
    ["MAT2", 4],
    ["MAT3", 9],
    ["MAT4", 16],
  ]);

  private renderRequested: boolean = false;

  private gl: WebGLRenderingContext;
  private shaderCache: ShaderCache;

  private gltf: LoadedGltf;
  private dataViewToWebGLBuffer = new Map<number, WebGLBuffer>();
  private textureToWebGLTexture = new Map<number, WebGLTexture>();

  private animator: Animator;
  private viewMatrix: Mat4Math.Mat4;

  private nodeGlobalMatrices: Mat4Math.Mat4[] = [];

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
    this.shaderCache = new ShaderCache(this.gl);

    this.renderLoop();
  }

  requestRender(viewMatrix: Mat4Math.Mat4 = this.viewMatrix): void {
    this.viewMatrix = viewMatrix;
    this.renderRequested = true;
  }

  setGltf(loadedGltf: LoadedGltf): void {
    this.deleteBuffersAndTextures();
    this.gltf = loadedGltf;
    this.updateNodeGlobalMatrices();

    if (this.gltf.animations) {
      this.animator = new Animator(this.gltf);
    }
  }

  private renderLoop = () => {
    if (this.renderRequested) {
      this.renderRequested = false;
      this.render(this.viewMatrix);
    }
    window.requestAnimationFrame(this.renderLoop);
  };

  private render(viewMatrix: Mat4Math.Mat4): void {
    if (this.animator) {
      this.animator.animate();
      this.updateNodeGlobalMatrices();
      this.renderRequested = true;
    }

    // update projectionmatrix
    const fieldOfView = (45 * Math.PI) / 180; // in radians
    const aspect = this.gl.canvas.width / this.gl.canvas.height;
    const zNear = 0.1;
    const zFar = 1000.0;
    const projectionMatrix = Mat4Math.perspective(fieldOfView, aspect, zNear, zFar);

    // clear canvas
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
    this.gl.clearDepth(1.0);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LEQUAL);

    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

    if (!this.gltf) {
      return;
    }

    this.gltf.nodes.forEach((node, nodeIdx) => {
      this.renderNode(nodeIdx, viewMatrix, projectionMatrix);
    });
  }

  private deleteBuffersAndTextures(): void {
    this.dataViewToWebGLBuffer.forEach((webGLBuffer, dataViewIdx) => {
      this.gl.deleteBuffer(webGLBuffer);
    });
    this.dataViewToWebGLBuffer.clear();

    this.textureToWebGLTexture.forEach((WebGLTexture, dataViewIdx) => {
      this.gl.deleteTexture(WebGLTexture);
    });
    this.textureToWebGLTexture.clear();
  }

  private renderNode(nodeIdx: number, viewMatrix: Mat4Math.Mat4, projectionMatrix: Mat4Math.Mat4): void {
    const node = this.gltf.nodes[nodeIdx];

    if (this.nodeGlobalMatrices[nodeIdx] && node.hasOwnProperty("mesh")) {
      const bones = node.hasOwnProperty("skin") ? this.getBones(nodeIdx) : null;
      const meshPrimitives = this.gltf.meshes[node.mesh].primitives;
      meshPrimitives.forEach((meshPrimitive) => {
        this.renderMeshPrimitive(meshPrimitive, this.nodeGlobalMatrices[nodeIdx], viewMatrix, projectionMatrix, bones);
      });
    }
  }

  private renderMeshPrimitive(
    meshPrimitive: GlTf.MeshPrimitive,
    modelMatrix: Mat4Math.Mat4,
    viewMatrix: Mat4Math.Mat4,
    projectionMatrix: Mat4Math.Mat4,
    bones: Float32Array
  ): void {
    if (!meshPrimitive.hasOwnProperty("material") || !this.gltf.materials[meshPrimitive.material].hasOwnProperty("pbrMetallicRoughness")) {
      return;
    }

    // get shader program and use it
    const shaderInfo = this.getShaderInfo(this.gltf.materials[meshPrimitive.material], meshPrimitive);
    this.gl.useProgram(shaderInfo.program);

    // update uniforms
    this.initMaterialTextures(this.gltf.materials[meshPrimitive.material]);
    this.updateMaterialUniforms(shaderInfo, this.gltf.materials[meshPrimitive.material]);

    const inverseModelMatrix = Mat4Math.invert(modelMatrix);
    const transposedInversedModeMatrix = Mat4Math.transpose(inverseModelMatrix);
    const modelMatrixForNormal = Mat4Math.getSubMatrix3(transposedInversedModeMatrix);

    this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.viewMatrix, false, viewMatrix);
    this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
    this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.modelMatrix, false, modelMatrix);
    this.gl.uniformMatrix3fv(shaderInfo.uniformLocations.modelMatrixForNormal, false, modelMatrixForNormal);

    if (meshPrimitive.attributes.hasOwnProperty("JOINTS_0") && bones) {
      this.gl.uniformMatrix4fv(shaderInfo.uniformLocations.bones, false, bones);
    }

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
    const usedAttribLocations: number[] = [];
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
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
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
      usedAttribLocations.push(attribLocation);
    }

    // draw
    if (vertexCount > 0) {
      const renderMode = meshPrimitive.mode === undefined ? this.gl.TRIANGLES : meshPrimitive.mode;
      if (indexAccessor) {
        this.gl.drawElements(renderMode, indexAccessor.count, indexAccessor.componentType, indexAccessor.byteOffset);
      } else {
        this.gl.drawArrays(renderMode, 0, vertexCount);
      }
    }

    // disable vertexAttribArrays
    usedAttribLocations.forEach((attribLocation) => {
      this.gl.disableVertexAttribArray(attribLocation);
    });
  }

  private getShaderInfo(material: GlTf.Material, meshPrimitive: GlTf.MeshPrimitive): ShaderInfo {
    const vertexDefines: string[] = [];
    const fragmentDefines: string[] = [];

    if (material.pbrMetallicRoughness.hasOwnProperty("baseColorTexture")) {
      fragmentDefines.push("HAS_BASE_COLOR_TEXTURE");
    }
    if (material.hasOwnProperty("normalTexture")) {
      fragmentDefines.push("HAS_NORMAL_TEXTURE");
    }
    if (meshPrimitive.attributes.hasOwnProperty("TEXCOORD_0")) {
      vertexDefines.push("HAS_UVS");
    }
    if (meshPrimitive.attributes.hasOwnProperty("JOINTS_0")) {
      vertexDefines.push("HAS_SKINNING");
    }

    return this.shaderCache.getShaderProgram(vertexDefines, fragmentDefines);
  }

  private initMaterialTextures(material: GlTf.Material): void {
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
      }
    }

    if (material.hasOwnProperty("normalTexture")) {
      const textureIdx = material.normalTexture.index;
      let webGLNormalTexture = this.textureToWebGLTexture.get(textureIdx);

      if (!webGLNormalTexture) {
        // initializing texture
        webGLNormalTexture = this.gl.createTexture();
        this.textureToWebGLTexture.set(textureIdx, webGLNormalTexture);

        const image = this.gltf.images[this.gltf.textures[textureIdx].source];

        this.gl.bindTexture(this.gl.TEXTURE_2D, webGLNormalTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
      }
    }
  }

  private updateMaterialUniforms(shaderInfo: ShaderInfo, material: GlTf.Material): void {
    // set culling based on "doubleSided" property
    if (material.doubleSided) {
      this.gl.disable(this.gl.CULL_FACE);
    } else {
      this.gl.enable(this.gl.CULL_FACE);
      this.gl.cullFace(this.gl.BACK);
    }

    // set blending based on alpha mode
    // TODO: imeplement "MASK" with alpha cutoff. You'll have to do it manually in a shader
    // TODO: also implement ordering opaque objects based on distance from camera
    if (material.alphaMode === "BLEND") {
      this.gl.enable(this.gl.BLEND);
      this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
    } else {
      this.gl.disable(this.gl.BLEND);
    }

    // color uniforms
    this.gl.uniform4fv(shaderInfo.uniformLocations.color, material.pbrMetallicRoughness.baseColorFactor || [1, 1, 1, 1]);
    if (material.pbrMetallicRoughness.hasOwnProperty("baseColorTexture")) {
      this.gl.uniform1i(shaderInfo.uniformLocations.colorSampler, 0);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.textureToWebGLTexture.get(material.pbrMetallicRoughness.baseColorTexture.index));
    }

    // normal uniforms
    if (material.hasOwnProperty("normalTexture")) {
      this.gl.uniform1i(shaderInfo.uniformLocations.normalSampler, 1);
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.textureToWebGLTexture.get(material.normalTexture.index));
    }
  }

  private updateNodeGlobalMatrices(): void {
    const processNode = (nodeId: number, parentModelMatrix: Mat4Math.Mat4) => {
      const node = this.gltf.nodes[nodeId];
      const modelMatrix = Mat4Math.multiply(parentModelMatrix, node.matrix as Mat4Math.Mat4);
      this.nodeGlobalMatrices[nodeId] = modelMatrix;

      if (node.hasOwnProperty("children")) {
        for (let chId of node.children) {
          processNode(chId, modelMatrix);
        }
      }
    };

    this.gltf.rootNodeIds.forEach((nodeId) => {
      processNode(nodeId, Mat4Math.create());
    });
  }

  private getBones(nodeIdx: number): Float32Array {
    const node = this.gltf.nodes[nodeIdx];
    const inverseNodeGlobalMatrix = Mat4Math.invert(this.nodeGlobalMatrices[nodeIdx]);
    const skin = this.gltf.skins[node.skin];

    if (skin.joints.length > 20) {
      window.alert("number of bones in the file is bigger than 20, which is max supported number.");
      return;
    }

    const result = new Float32Array(20 * 16);

    for (let i = 0; i < skin.joints.length; i++) {
      let matrix = Mat4Math.multiply(inverseNodeGlobalMatrix, this.nodeGlobalMatrices[skin.joints[i]]);
      if (skin.hasOwnProperty("inverseBindMatricesData")) {
        matrix = Mat4Math.multiply(matrix, skin.inverseBindMatricesData[i]);
      }

      result.set(matrix, i * 16);
    }

    return result;
  }
}
