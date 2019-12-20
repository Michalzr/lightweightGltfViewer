import { Renderer } from "./renderer.js"
import { OrbitControls } from "./orbitControls.js"
import { bindDragAndDrop, bindResize, bindModelSelect } from "./uiBindings.js"
import { GltfLoader } from "./gltfLoader.js"
import { NamedBlob } from "./utils/fileUtils.js";

// TODO:
// - Textures
//       - use sampler values
//       - implement fallback for when texture size is not power of two (only under some sampler conditions..)
// - Implement environment light
// - Implement other PBR material properties - metalness, ..

// IDEAS:
// - fill default gltf values, so you don't need to check every time if property actually exists.. You're already doing this with matrices, normals and tangents
// - only update material uniforms when necessary
// - implement extra level of shader caching - every mesh primitive remembers the shader it used - no need to collect "defines" every frame
// - only enable/disable vertexAttrib arrays when necessary

// 8, 5, 4, 2

function run() {
    const canvas = document.querySelector("#glCanvas") as HTMLCanvasElement;
    const modelSelect = document.querySelector("#modelSelect") as HTMLSelectElement;

    const renderer = new Renderer(canvas);
    const orbitControls = new OrbitControls(canvas);

    function requestRender() {
        renderer.requestRender(orbitControls.getViewMatrix());
    }

    async function loadFiles(files: NamedBlob[]) {
        const loadedGltf = await new GltfLoader().load(files);
        orbitControls.resetCamera();
        renderer.setGltf(loadedGltf);
        requestRender();
    }

    // bind the UI
    bindResize(canvas, requestRender);
    bindDragAndDrop(canvas, loadFiles);
    bindModelSelect(modelSelect, loadFiles);

    // instead of having render loop, we only render when moving camera
    orbitControls.sigChange.connect(requestRender);
}

run();