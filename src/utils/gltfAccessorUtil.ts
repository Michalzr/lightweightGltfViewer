import { LoadedGltf } from "../gltfLoader";
import * as GlTf from "../gltfInterface.js"


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

export function getTypedArray(loadedGltf: LoadedGltf, accessorIdx: number): Float32Array {
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

export function getIndices(loadedGltf: LoadedGltf, meshPrimitive: GlTf.MeshPrimitive): Uint32Array {
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