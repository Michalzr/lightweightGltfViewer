import { LoadedGltf } from "./gltfLoader.js"
import * as Mat4Math from "./utils/mathUtils/martix4.js";

export class Animator {
    private loadedGltf: LoadedGltf;

    constructor(loadedGltf: LoadedGltf) {
        this.loadedGltf = loadedGltf;
    }

    getBonesMatrices(nodeIdx: number, globalMatrices: Mat4Math.Mat4[]): Float32Array {
        const node = this.loadedGltf.nodes[nodeIdx];
        const inverseNodeGlobalMatrix = Mat4Math.invert(globalMatrices[nodeIdx]);
        const skin = this.loadedGltf.skins[node.skin];

        const result = new Float32Array(skin.joints.length * 16);

        for (let i = 0; i < skin.joints.length; i++) {
            let matrix = Mat4Math.multiply(inverseNodeGlobalMatrix, globalMatrices[skin.joints[i]]);
            if (skin.hasOwnProperty("inverseBindMatricesData")) {
                matrix = Mat4Math.multiply(globalMatrices[skin.joints[i]], skin.inverseBindMatricesData[i]);
            }

            result.set(matrix, i * 16);
        }

        return result;
    }
}