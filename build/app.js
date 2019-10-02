var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Renderer } from "./renderer.js";
import { OrbitControls } from "./orbitControls.js";
import { bindDragAndDrop } from "./dragAndDrop.js";
import { GltfLoader } from "./gltfLoader.js";
const vertexShaderSource = `
attribute vec3 position;
attribute vec3 normal;

uniform mat4 modelMatrix;
uniform mat3 modelMatrixForNormal;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

varying vec3 vNormal;

void main() {
  vNormal = mat3(viewMatrix) * modelMatrixForNormal * normal;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position.xyz, 1);
}
`;
const fragmentShaderSource = `
precision mediump float;

varying vec3 vNormal;

void main() {
  float intensity = max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
  gl_FragColor = vec4(intensity, intensity, intensity, 1.0);
}
`;
function run() {
    const canvas = document.querySelector("#glCanvas");
    const renderer = new Renderer(canvas);
    const orbitControls = new OrbitControls(canvas);
    function onGltfLoad(loadedGltf) {
        renderer.setGltf(loadedGltf);
        renderer.render(orbitControls.getViewMatrix());
    }
    bindDragAndDrop(canvas, (files) => __awaiter(this, void 0, void 0, function* () {
        const loadedGltf = yield new GltfLoader().load(files);
        onGltfLoad(loadedGltf);
    }));
    renderer.initShader("shaderIndex", vertexShaderSource, fragmentShaderSource);
    orbitControls.sigChange.connect(() => {
        renderer.render(orbitControls.getViewMatrix());
    });
}
run();
//# sourceMappingURL=app.js.map