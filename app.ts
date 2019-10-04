import { Renderer } from "./renderer.js"
import { OrbitControls } from "./orbitControls.js"
import { bindDragAndDrop } from "./dragAndDrop.js"
import { LoadedGltf, GltfLoader } from "./gltfLoader.js"

// TODO:
// - "Drag&Drop" vycisti sucasnu scenu a nahradi ju novou (daj si pozor na uvolnenie vsetkej pamate!)

const vertexShaderSource = `
attribute vec3 position;
attribute vec3 normal;

uniform mat4 modelMatrix;
uniform mat3 modelMatrixForNormal;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

varying vec3 vNormal;

void main() {
  vNormal = normalize(mat3(viewMatrix) * modelMatrixForNormal * normal);
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
  const canvas = document.querySelector("#glCanvas") as HTMLCanvasElement;

  const renderer = new Renderer(canvas);
  const orbitControls = new OrbitControls(canvas);


  function onGltfLoad(loadedGltf: LoadedGltf): void {
    renderer.setGltf(loadedGltf);
    renderer.render(orbitControls.getViewMatrix());
  }

  bindDragAndDrop(canvas, async files => {
    const loadedGltf = await new GltfLoader().load(files);
    onGltfLoad(loadedGltf);
  });

  renderer.initShader("shaderIndex", vertexShaderSource, fragmentShaderSource);

  orbitControls.sigChange.connect(() => {
    // instead of having render loop, we only render when moving camera
    renderer.render(orbitControls.getViewMatrix());
  });
}

run();