import { LoadedGltf } from "./gltfLoader.js"
import * as GlTf from "./gltfInterface.js"
import * as Mat4Math from "./utils/mathUtils/martix4.js"
import * as Vec3Math from "./utils/mathUtils/vector3.js"
import * as QuaternionMath from "./utils/mathUtils/quaternion.js"

// this function fills the loaded gltf with default values, so we don't have to check for undefined throughout the code..
export function fillGltfDefaultValues(loadedGltf: LoadedGltf): void {
    // make sure every node has matrix
    fillMatrices(loadedGltf);

    // make sure every geometry has normals
    fillNormalData(loadedGltf);
        
}

function fillMatrices(loadedGltf: LoadedGltf): void {
    loadedGltf.nodes.forEach(node => {
        if (!node.matrix) {
            const translation: Vec3Math.Vec3 = node.translation as Vec3Math.Vec3 || [0, 0, 0];
            const rotation: QuaternionMath.Quaternion = node.rotation as QuaternionMath.Quaternion || QuaternionMath.create();
            const scale: Vec3Math.Vec3 = node.scale as Vec3Math.Vec3 || [1, 1, 1];
    
            node.matrix = Mat4Math.fromTranslationRotationScale(translation, rotation, scale);
        }
    });
}

function fillNormalData(loadedGltf: LoadedGltf): void {
    const cachedNormalAttributes = new Map<number, number>();

    loadedGltf.meshes.forEach(mesh => {
        mesh.primitives.forEach(generateNormals);
    });

    function generateNormals(meshPrimitive: GlTf.MeshPrimitive) {
        if (meshPrimitive.attributes.hasOwnProperty("NORMAL")) {
            return;
        }

        if (cachedNormalAttributes.has(meshPrimitive.attributes["POSITION"])) {
            meshPrimitive.attributes.NORMAL = cachedNormalAttributes.get(meshPrimitive.attributes["POSITION"]);
            return;
        }

        const positionAccessor = loadedGltf.accessors[meshPrimitive.attributes["POSITION"]];
        const positionDataView = loadedGltf.dataViews[positionAccessor.bufferView];

        const vertices = new Float32Array(positionAccessor.count * 3);

        let pByteStride = positionAccessor.byteStride || (3 * 4);
        let pIndex = positionAccessor.byteOffset || 0;

        for (let i = 0; i < vertices.length; i += 3) {
            vertices[i] = positionDataView.getFloat32(pIndex, true);
            vertices[i + 1] = positionDataView.getFloat32(pIndex + 4, true);
            vertices[i + 2] = positionDataView.getFloat32(pIndex + 8, true);

            pIndex += pByteStride;
        }

        const normals = new Float32Array(positionAccessor.count * 3);
        
        const h1: Vec3Math.Vec3 = [0, 0, 0]; // helper vectors
        const h2: Vec3Math.Vec3 = [0, 0, 0];
        const normal: Vec3Math.Vec3 = [0, 0, 0];

        for (let i = 0; i < normals.length; i += 9) {
            h1[0] = vertices[i + 3] - vertices[i];
            h1[1] = vertices[i + 4] - vertices[i + 1];
            h1[2] = vertices[i + 5] - vertices[i + 2];

            h2[0] = vertices[i + 6] - vertices[i];
            h2[1] = vertices[i + 7] - vertices[i + 1];
            h2[2] = vertices[i + 8] - vertices[i + 2];

            normal[0] = h1[1] * h2[2] - h1[2] * h2[1];
            normal[1] = h1[2] * h2[0] - h1[0] * h2[2];
            normal[2] = h1[0] * h2[1] - h1[1] * h2[0];

            Vec3Math.normalize(normal);

            for (let j = 0; j < 3; j++) {
                normals[i + j * 3] = normal[0];
                normals[i + j * 3 + 1] = normal[1];
                normals[i + j * 3 + 2] = normal[2];
            }
        }

        const normalDataView = new DataView(normals.buffer);
        loadedGltf.dataViews.push(normalDataView);

        const normalAccessor = {
            bufferView: loadedGltf.dataViews.length - 1,
            componentType: 5126,
            normalized: true,
            count: positionAccessor.count,
            type: "VEC3"
        }
        loadedGltf.accessors.push(normalAccessor);

        meshPrimitive.attributes.NORMAL = loadedGltf.accessors.length - 1;

        cachedNormalAttributes.set(meshPrimitive.attributes["POSITION"], meshPrimitive.attributes["NORMAL"]);
    }
}