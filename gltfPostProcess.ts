import { LoadedGltf } from "./gltfLoader.js"
import * as GlTf from "./gltfInterface.js"
import * as Mat4Math from "./utils/mathUtils/martix4.js"
import * as Vec3Math from "./utils/mathUtils/vector3.js"
import * as QuaternionMath from "./utils/mathUtils/quaternion.js"

// fills the loaded gltf with default values, so we don't have to check for undefined throughout the code..
export function fillGltfDefaultValues(loadedGltf: LoadedGltf): void {
    // make sure every node has matrix
    fillMatrices(loadedGltf);

    // make sure every geometry has normals
    fillNormalData(loadedGltf);
        
}

// resize and move the loaded scene so it fits default orbit controls setup (fit in 1x1x1 box with center in (0,0,0))
export function fitToView(loadedGltf: LoadedGltf): void {
    let min: Vec3Math.Vec3 = [Infinity, Infinity, Infinity];
    let max: Vec3Math.Vec3 = [-Infinity, -Infinity, -Infinity];
    
    function processMesh(meshPrimitive: GlTf.MeshPrimitive, matrix: Mat4Math.Mat4) {
        if (!meshPrimitive.attributes.hasOwnProperty("POSITION")) {
            return;
        }

        const positionAttribute = loadedGltf.accessors[meshPrimitive.attributes["POSITION"]];

        if (positionAttribute.hasOwnProperty("max") && positionAttribute.hasOwnProperty("min")) {
            const localMax = Vec3Math.applyMatrix(positionAttribute.max as Vec3Math.Vec3, matrix);
            const localMin = Vec3Math.applyMatrix(positionAttribute.min as Vec3Math.Vec3, matrix);

            max = [Math.max(max[0], localMax[0]), Math.max(max[1], localMax[1]), Math.max(max[2], localMax[2])];
            max = [Math.max(max[0], localMin[0]), Math.max(max[1], localMin[1]), Math.max(max[2], localMin[2])];
            min = [Math.min(min[0], localMin[0]), Math.min(min[1], localMin[1]), Math.min(min[2], localMin[2])];
            min = [Math.min(min[0], localMax[0]), Math.min(min[1], localMax[1]), Math.min(min[2], localMax[2])];
        
        } else {
            console.error("Min and max positions are undefined. Fitting will not work well.");
        }
    }

    function processNode(node: GlTf.Node, parentMatrix: Mat4Math.Mat4) {
        const matrix = Mat4Math.multiply(parentMatrix, node.matrix as Mat4Math.Mat4);
        
        if (node.children) {
            node.children.forEach(nodeId => {
                processNode(loadedGltf.nodes[nodeId], matrix);
            });
        }

        if (!node.hasOwnProperty("mesh")) {
            return;
        }

        const meshPrimitives = loadedGltf.meshes[node.mesh].primitives;
        meshPrimitives.forEach(meshPrimitive => processMesh(meshPrimitive, matrix));
    }

    loadedGltf.rootNodeIds.forEach(nodeId => {
        processNode(loadedGltf.nodes[nodeId], Mat4Math.create());
    });

    if (min[0] < max[0]) {
        const center = Vec3Math.multiplyScalar(Vec3Math.add(Vec3Math.clone(min), max), 1/2);
        const size = Vec3Math.sub(Vec3Math.clone(max), min);
        const maxSize = Math.max(Math.max(size[0], size[1]), size[2]);

        const scale: Vec3Math.Vec3 = [1 / maxSize, 1 / maxSize, 1 / maxSize];
        const translate = Vec3Math.multiply(Vec3Math.negate(center), scale);
        const rotate = QuaternionMath.create();

        const fitMatrix = Mat4Math.fromTranslationRotationScale(translate, rotate, scale);

        loadedGltf.rootNodeIds.forEach(nodeId => {
            loadedGltf.nodes[nodeId].matrix = Mat4Math.multiply(fitMatrix, loadedGltf.nodes[nodeId].matrix as Mat4Math.Mat4);
        })
    }
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

const COMPONENT_BYTESIZE: Map<number, number> = new Map([
    [5120, 1],
    [5121, 1],
    [5122, 2],
    [5123, 2],
    [5125, 4],
    [5126, 4]
]);

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


        // load vertices
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


        // load indices
        let indices: Uint32Array;
        if (meshPrimitive.hasOwnProperty("indices")) {
            const indexAccessor = loadedGltf.accessors[meshPrimitive.indices];
            const indexDataView = loadedGltf.dataViews[indexAccessor.bufferView];

            let indexByteLenght = COMPONENT_BYTESIZE.get(indexAccessor.componentType);

            indices = new Uint32Array(indexAccessor.count);

            let iByteStride = indexAccessor.byteStride || indexByteLenght;
            let iIndex = indexAccessor.byteOffset || 0;

            let getNumber = (iIndex: number) => indexDataView.getUint32(iIndex, true);
            if (indexByteLenght === 2) {
                getNumber = (iIndex: number) => indexDataView.getUint16(iIndex, true);
            } else if (indexByteLenght === 1) {
                getNumber = (iIndex: number) => indexDataView.getUint8(iIndex);
            }

            for (let i = 0; i < indices.length; i++) {
                indices[i] = getNumber(iIndex);
                iIndex += iByteStride;
            }
        } else {
            indices = new Uint32Array(positionAccessor.count);
            for (let i = 0; i < indices.length; i++) {
                indices[i] = i;
            }
        }


        // generate normals
        const normals = new Float32Array(positionAccessor.count * 3);

        const h1: Vec3Math.Vec3 = [0, 0, 0]; // helper vectors
        const h2: Vec3Math.Vec3 = [0, 0, 0];
        const normal: Vec3Math.Vec3 = [0, 0, 0];
        const ti: [number, number, number] = [0, 0, 0]; // triangle indices
        let j, k: number;

        for (let i = 0; i < indices.length; i += 3) {
            for (j = 0; j < 3; j++) {
                ti[j] = indices[i + j] * 3;
            }

            for (j = 0; j < 3; j++) {            
                h1[j] = vertices[ti[1] + j] - vertices[ti[0] + j];
                h2[j] = vertices[ti[2] + j] - vertices[ti[0] + j];
            }

            normal[0] = h1[1] * h2[2] - h1[2] * h2[1];
            normal[1] = h1[2] * h2[0] - h1[0] * h2[2];
            normal[2] = h1[0] * h2[1] - h1[1] * h2[0];

            Vec3Math.normalize(normal);

            for (j = 0; j < 3; j++) {
                for (k = 0; k < 3; k++) {
                    normals[ti[j] + k] += normal[k];
                }
            }
        }

        for (let i = 0; i < normals.length; i += 3) {
            for (j = 0; j < 3; j++) {
                normal[j] = normals[i + j];
            }
            Vec3Math.normalize(normal);
            for (j = 0; j < 3; j++) {
                normals[i + j] = normal[j];
            }
        }


        // write normals accessor to gltf
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