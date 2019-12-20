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
 
    // make sure every geometry that has UVs, has also tangents
    fillTangentData(loadedGltf);

    // read the bind pose data to a more readable form - array of matrices
    fillBindPoseData(loadedGltf);

    // read the animation data to a more readable form
    fillAnimationData(loadedGltf);
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

        loadedGltf.nodes.push({
            name: "fitToViewRoot",
            children: loadedGltf.rootNodeIds,
            matrix: fitMatrix
        });

        loadedGltf.rootNodeIds = [loadedGltf.nodes.length - 1];
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

const NUMBER_OF_COMPONENTS: Map<string, number> = new Map([
    ["SCALAR", 1],
    ["VEC2", 2],
    ["VEC3", 3],
    ["VEC4", 4],
    ["MAT2", 4],
    ["MAT3", 9],
    ["MAT4", 16]
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


        // load vertices and indices
        const positions = getTypedArray(loadedGltf, meshPrimitive.attributes["POSITION"]);
        const indices = getIndices(loadedGltf, meshPrimitive);


        // generate normals
        const normals = new Float32Array(positions.length);

        const h1: Vec3Math.Vec3 = [0, 0, 0]; // helper vectors
        const h2: Vec3Math.Vec3 = [0, 0, 0];
        const normal: Vec3Math.Vec3 = [0, 0, 0];
        const ti: [number, number, number] = [0, 0, 0]; // triangle indices
        let j: number, k: number;

        for (let i = 0; i < indices.length; i += 3) {
            for (j = 0; j < 3; j++) {
                ti[j] = indices[i + j] * 3;
            }

            for (j = 0; j < 3; j++) {            
                h1[j] = positions[ti[1] + j] - positions[ti[0] + j];
                h2[j] = positions[ti[2] + j] - positions[ti[0] + j];
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
            count: positions.length / 3,
            type: "VEC3"
        }
        loadedGltf.accessors.push(normalAccessor);

        meshPrimitive.attributes.NORMAL = loadedGltf.accessors.length - 1;

        cachedNormalAttributes.set(meshPrimitive.attributes["POSITION"], meshPrimitive.attributes["NORMAL"]);
    }
}


function fillTangentData(loadedGltf: LoadedGltf): void {
    const cachedTangentAttributes = new Map<string, number>();

    loadedGltf.meshes.forEach(mesh => {
        mesh.primitives.forEach(generateTangents);
    });

    function generateTangents(meshPrimitive: GlTf.MeshPrimitive) {
        if (meshPrimitive.attributes.hasOwnProperty("TANGENT") || !(meshPrimitive.attributes.hasOwnProperty("TEXCOORD_0"))) {
            return;
        }

        const tangentsCacheKey = meshPrimitive.attributes["POSITION"] + "_" +
            meshPrimitive.indices + "_" +
            meshPrimitive.attributes["NORMAL"] + "_" +
            meshPrimitive.attributes["TEXCOORD_0"];

        if (cachedTangentAttributes.has(tangentsCacheKey)) {
            meshPrimitive.attributes.TANGENT = cachedTangentAttributes.get(tangentsCacheKey);
            return;
        }

        // load vertices, indices, normals and uvs
        const positions = getTypedArray(loadedGltf, meshPrimitive.attributes["POSITION"]);
        const indices = getIndices(loadedGltf, meshPrimitive);
        const normals = getTypedArray(loadedGltf, meshPrimitive.attributes["NORMAL"]);
        const uvs = getTypedArray(loadedGltf, meshPrimitive.attributes["TEXCOORD_0"]);


        // generate tangents (inspired by THREE.js BufferGeometryUtil)
        const tangents1 = new Float32Array(positions.length * 4 / 3);
        const tangents2 = new Float32Array(positions.length * 4 / 3);
        let x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, s1: number, t1: number, s2: number, t2: number, r: number;

		function handleTriangle(viA: number, viB: number, viC: number) {
			x1 = positions[viB * 3 + 0] - positions[viA * 3 + 0];
            y1 = positions[viB * 3 + 1] - positions[viA * 3 + 1];
            z1 = positions[viB * 3 + 2] - positions[viA * 3 + 2];
                    
            x2 = positions[viC * 3 + 0] - positions[viA * 3 + 0];
            y2 = positions[viC * 3 + 1] - positions[viA * 3 + 1];
            z2 = positions[viC * 3 + 2] - positions[viA * 3 + 2];

            s1 = uvs[viB * 2] - uvs[viA * 2];
            t1 = uvs[viB * 2 + 1] - uvs[viA * 2 + 1];

            s2 = uvs[viC * 2] - uvs[viA * 2];
            t2 = uvs[viC * 2 + 1] - uvs[viA * 2 + 1];

			r = 1.0 / ( s1 * t2 - s2 * t1 );

            for (let vi of [viA, viB, viC]) {
                tangents1[vi * 4 + 0] += ( t2 * x1 - t1 * x2 ) * r;
                tangents1[vi * 4 + 1] += ( t2 * y1 - t1 * y2 ) * r;
                tangents1[vi * 4 + 2] += ( t2 * z1 - t1 * z2 ) * r;
    
                tangents2[vi * 4 + 0] += ( s1 * x2 - s2 * x1 ) * r;
                tangents2[vi * 4 + 1] += ( s1 * y2 - s2 * y1 ) * r;
                tangents2[vi * 4 + 2] += ( s1 * z2 - s2 * z1 ) * r;
            }
		}

		for (var i = 0; i < indices.length; i += 3) {
            handleTriangle(indices[i], indices[ i + 1 ], indices[ i + 2 ]);
		}

        const n: Vec3Math.Vec3 = [0, 0, 0];
        const tangent1: Vec3Math.Vec3 = [0, 0, 0];
        const tangent2: Vec3Math.Vec3 = [0, 0, 0];
        const tmp: Vec3Math.Vec3 = [0, 0, 0];
        const tmp2: Vec3Math.Vec3 = [0, 0, 0];
        let test: number, w: number;

		function handleVertex(vIndex: number) {
            n[0] = normals[vIndex * 3];
            n[1] = normals[vIndex * 3 + 1];
            n[2] = normals[vIndex * 3 + 2];

            tangent1[0] = tangents1[vIndex * 4];
            tangent1[1] = tangents1[vIndex * 4 + 1];
            tangent1[2] = tangents1[vIndex * 4 + 2];

            tangent2[0] = tangents2[vIndex * 4];
            tangent2[1] = tangents2[vIndex * 4 + 1];
            tangent2[2] = tangents2[vIndex * 4 + 2];

			// Gram-Schmidt orthogonalize
            Vec3Math.copy(tmp, tangent1);
            Vec3Math.copy(tmp2, n);
            Vec3Math.sub(tmp, Vec3Math.multiplyScalar(tmp2, Vec3Math.dot(tmp2, tangent1))); 
            Vec3Math.normalize(tmp);

			// Calculate handedness
			Vec3Math.cross(n, tangent1, tmp2);
			test = Vec3Math.dot(tmp2, tangent2);
			w = ( test < 0.0 ) ? - 1.0 : 1.0;

			tangents1[ vIndex * 4 ] = tmp[0];
			tangents1[ vIndex * 4 + 1 ] = tmp[1];
			tangents1[ vIndex * 4 + 2 ] = tmp[2];
			tangents1[ vIndex * 4 + 3 ] = w;
		}

		for (let i = 0; i < indices.length; i ++) {
            handleVertex(indices[i]);
		}


        // write tangent accessor to gltf
        const tangentDataView = new DataView(tangents1.buffer);
        loadedGltf.dataViews.push(tangentDataView);

        const tangentAccessor = {
            bufferView: loadedGltf.dataViews.length - 1,
            componentType: 5126,
            count: tangents1.length / 4,
            type: "VEC4"
        }
        loadedGltf.accessors.push(tangentAccessor);

        meshPrimitive.attributes.TANGENT = loadedGltf.accessors.length - 1;

        cachedTangentAttributes.set(tangentsCacheKey, meshPrimitive.attributes["TANGENT"]);
    }
}

function fillBindPoseData(loadedGltf: LoadedGltf): void {
    if (loadedGltf.skins) {
        loadedGltf.skins.forEach(skin => {
            if (skin.hasOwnProperty("inverseBindMatrices")) {
                const matricesTypedArray = getTypedArray(loadedGltf, skin.inverseBindMatrices);
                const matricesArray: Mat4Math.Mat4[] = new Array(matricesTypedArray.length / 16);
                for (let i = 0; i < matricesArray.length; i ++) {
                    matricesArray[i] = Array.prototype.slice.call(matricesTypedArray, i * 16, (i + 1) * 16);
                }
        
                skin.inverseBindMatricesData = matricesArray;
            }
        });
    }
}

function fillAnimationData(loadedGltf: LoadedGltf): void {
    if (loadedGltf.animations) {
        loadedGltf.animations.forEach(animation => {
            animation.samplers.forEach(animationSampler => {
                animationSampler.inputData = getTypedArrayForSampler(loadedGltf, animationSampler.input);
                animationSampler.outputData = getTypedArrayForSampler(loadedGltf, animationSampler.output);
            });
        });
    }
}

function getTypedArrayForSampler(loadedGltf: LoadedGltf, accessorIdx: number): Float32Array {
    const dataAccessor = loadedGltf.accessors[accessorIdx];
    const dataView = loadedGltf.dataViews[dataAccessor.bufferView];

    const componentByteLenght = COMPONENT_BYTESIZE.get(dataAccessor.componentType);
    const numberOfComponents = NUMBER_OF_COMPONENTS.get(dataAccessor.type);
    const elementByteStride = dataAccessor.byteStride || componentByteLenght * numberOfComponents;
    let elementIndex = dataAccessor.byteOffset || 0;

    const result = new Float32Array(dataAccessor.count * numberOfComponents);

    let getNumber: (iIndex: number) => number;

    if (dataAccessor.componentType === 5120) { // byte
        getNumber = (iIndex: number) => Math.max(dataView.getInt8(iIndex) / 127.0, -1.0);
    } else if (dataAccessor.componentType === 5121) { // ubyte
        getNumber = (iIndex: number) => dataView.getUint8(iIndex) / 255;
    } else if (dataAccessor.componentType === 5122) { // short
        getNumber = (iIndex: number) => Math.max(dataView.getInt16(iIndex) / 32767.0, -1.0);
    } else if (dataAccessor.componentType === 5123) { // ushort
        getNumber = (iIndex: number) => dataView.getUint16(iIndex, true) / 65535.0;
    }  else if (dataAccessor.componentType === 5125) { // uint
        getNumber = (iIndex: number) => dataView.getUint32(iIndex, true);
    } else { // float
        getNumber = (iIndex: number) => dataView.getFloat32(iIndex, true);
    }

    for (let i = 0, j = 0; i < result.length; i += numberOfComponents) {
        for (j = 0; j < numberOfComponents; j++) {
            result[i + j] = getNumber(elementIndex + j * componentByteLenght);
        }
        elementIndex += elementByteStride;
    }

    return result;
}

function getTypedArray(loadedGltf: LoadedGltf, accessorIdx: number): Float32Array {
    const dataAccessor = loadedGltf.accessors[accessorIdx];
    const dataView = loadedGltf.dataViews[dataAccessor.bufferView];

    const componentByteLenght = COMPONENT_BYTESIZE.get(dataAccessor.componentType);
    const numberOfComponents = NUMBER_OF_COMPONENTS.get(dataAccessor.type);
    const elementByteStride = dataAccessor.byteStride || componentByteLenght * numberOfComponents;
    let elementIndex = dataAccessor.byteOffset || 0;

    const result = new Float32Array(dataAccessor.count * numberOfComponents);

    let getNumber = (iIndex: number) => dataView.getFloat32(iIndex, true);
    if (componentByteLenght === 2) {
        getNumber = (iIndex: number) => dataView.getUint16(iIndex, true);
    } else if (componentByteLenght === 1) {
        getNumber = (iIndex: number) => dataView.getUint8(iIndex);
    }

    for (let i = 0, j = 0; i < result.length; i += numberOfComponents) {
        for (j = 0; j < numberOfComponents; j++) {
            result[i + j] = getNumber(elementIndex + j * componentByteLenght);
        }
        elementIndex += elementByteStride;
    }

    return result;
}

function getIndices(loadedGltf: LoadedGltf, meshPrimitive: GlTf.MeshPrimitive): Uint32Array {
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
        indices = new Uint32Array(loadedGltf.accessors[meshPrimitive.attributes["POSITION"]].count);
        for (let i = 0; i < indices.length; i++) {
            indices[i] = i;
        }
    }

    return indices;
}