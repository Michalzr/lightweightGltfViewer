import { Renderer } from "./renderer.js"
import { OrbitControls } from "./orbitControls.js"
import { bindDragAndDrop } from "./dragAndDrop.js"
import { GltfLoader } from "./gltfLoader.js"

// last time you imeplemented normal mapping, it doesn't work well
// when you're done with that, test tangent computation

// TODO:
// - Color texture
//       - use sampler values
//       - implement fallback for when texture size is not power of two (only under some sampler conditions..)
// - Implement environment light
// - Implement other textures
// - If there aren't tangents in a primitive, compute them

// IDEAS:
// - fill default gltf values, so you don't need to check every time if property actually exists.. Properties that need this:
//     - baseColorFactor: [1, 1, 1, 1]
// - only update material uniforms when necessary
// - implement extra level of shader caching - every mesh primitive remembers the shader it used - no need to collect "defines"
// - only enable/disable vertexAttrib arrays when necessary

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