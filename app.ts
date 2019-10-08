import { Renderer } from "./renderer.js"
import { OrbitControls } from "./orbitControls.js"
import { bindDragAndDrop } from "./dragAndDrop.js"
import { GltfLoader } from "./gltfLoader.js"

// TODO:
// - Color texture
//       - find out why opacity doesn't work
//       - use sampler values
//       - implement fallback for when texture size is not power of two (only under some sampler conditions..)
// - Implement environment light
// - Implement other textures
// - If there aren't normals in a primitive, compute them
// - If there aren't tangents in a primitive, compute them

function run() {
    const canvas = document.querySelector("#glCanvas") as HTMLCanvasElement;

    const renderer = new Renderer(canvas);
    const orbitControls = new OrbitControls(canvas);

    bindDragAndDrop(canvas, async files => {
        const loadedGltf = await new GltfLoader().load(files);
        renderer.setGltf(loadedGltf);
        renderer.render(orbitControls.getViewMatrix());
    });

    orbitControls.sigChange.connect(() => {
        // instead of having render loop, we only render when moving camera
        renderer.render(orbitControls.getViewMatrix());
    });
}

run();