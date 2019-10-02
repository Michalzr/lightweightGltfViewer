var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { NamedBlob, preprocessUri } from "./utils/fileUtils.js";
import * as Mat4Math from "./utils/mathUtils/martix4.js";
import * as QuaternionMath from "./utils/mathUtils/quaternion.js";
export class GltfLoader {
    constructor() {
        this.textureSourceIdxToId = new Map();
        this.missingImagesURIs = [];
    }
    load(files) {
        return __awaiter(this, void 0, void 0, function* () {
            const gltfFile = files.find(f => f.name.endsWith(GltfLoader.gltfExtension) || f.name.endsWith(GltfLoader.glbExtension));
            if (!gltfFile) {
                window.alert("No \".gltf\" or \".glb\" file found.");
                return;
            }
            if (gltfFile.name.endsWith(GltfLoader.gltfExtension)) {
                return this.parseNonBinary(gltfFile, files);
            }
            else {
                return this.parseBinary(gltfFile, files);
            }
        });
    }
    parseBinary(glb, files) {
        return __awaiter(this, void 0, void 0, function* () {
            this.textureSourceIdxToId = new Map();
            const glbAsBuffer = yield new Response(glb.blob).arrayBuffer();
            const glbDataView = new DataView(glbAsBuffer);
            let offset = 0;
            const glbMagicIdentificator = glbDataView.getUint32(offset, true);
            if (glbMagicIdentificator !== 0x46546C67) {
                return Promise.reject(new Error("Not a real .glb file"));
            }
            offset += 4;
            const glbVersion = glbDataView.getUint32(offset, true);
            if (glbVersion !== 2) {
                return Promise.reject(new Error("Wrong gltf version. It must be 2."));
            }
            offset += 4;
            const overAllGlbSize = glbDataView.getUint32(offset, true);
            offset += 4;
            const jsonChunkSize = glbDataView.getUint32(offset, true);
            offset += 4;
            const jsonChunkType = glbDataView.getUint32(offset, true);
            if (jsonChunkType !== 0x4E4F534A) {
                return Promise.reject(new Error("First glb chunk must be JSON"));
            }
            offset += 4;
            const jsonChunkView = new DataView(glbAsBuffer, offset, jsonChunkSize);
            const gltfJsonAsString = new TextDecoder().decode(jsonChunkView);
            const gltfJson = JSON.parse(gltfJsonAsString);
            offset += jsonChunkSize;
            let chunkSize = 0;
            while (offset < overAllGlbSize) {
                chunkSize = glbDataView.getUint32(offset, true);
                offset += 4;
                const chunkType = glbDataView.getUint32(offset, true);
                const binDataFound = chunkType === 0x004E4942;
                offset += 4;
                if (binDataFound) {
                    break;
                }
                else {
                    offset += chunkSize;
                }
            }
            if (offset > overAllGlbSize) {
                return Promise.reject(new Error("Unable to find chunk containing binary buffer"));
            }
            const binaryBuffer = glbAsBuffer.slice(offset, offset + chunkSize);
            const data = yield this.loadImagesAndBuffers(gltfJson, files, binaryBuffer);
            return this.createImportData(gltfJson, data.buffers, data.imageFiles);
        });
    }
    parseNonBinary(gltf, files) {
        return __awaiter(this, void 0, void 0, function* () {
            this.textureSourceIdxToId = new Map();
            const gltfString = yield new Response(gltf.blob).text();
            const gltfJson = JSON.parse(gltfString);
            if (parseInt(gltfJson.asset.version[0]) !== 2) {
                return Promise.reject(new Error("Wrong gltf version. It must be 2."));
            }
            ;
            const data = yield this.loadImagesAndBuffers(gltfJson, files);
            return this.createImportData(gltfJson, data.buffers, data.imageFiles);
        });
    }
    loadImagesAndBuffers(gltfJson, files, glbBuffer) {
        return __awaiter(this, void 0, void 0, function* () {
            let imageFiles;
            let buffers;
            const bufferFilesPromises = gltfJson.buffers.map((b, i) => __awaiter(this, void 0, void 0, function* () {
                if (!b.uri) {
                    return Promise.resolve(glbBuffer);
                }
                if (/^data:.*,.*$/i.test(b.uri) || /^(https?:)?\/\//i.test(b.uri)) {
                    const response = yield fetch(b.uri);
                    if (!response.ok) {
                        return Promise.reject(new Error("File " + b.uri + " not found."));
                    }
                    return yield response.arrayBuffer();
                }
                else {
                    const processedFileUri = preprocessUri(b.uri);
                    const fileCandidate = files.find(file => file.name === processedFileUri);
                    if (!fileCandidate) {
                        return Promise.reject(new Error("File " + b.uri + " not found."));
                    }
                    return new Response(fileCandidate.blob).arrayBuffer();
                }
            }));
            buffers = yield Promise.all(bufferFilesPromises);
            if (gltfJson.images) {
                const imageFilesPromises = gltfJson.images.map((i, idx) => __awaiter(this, void 0, void 0, function* () {
                    if (i.uri) {
                        if (/^data:.*,.*$/i.test(i.uri) || /^(https?:)?\/\//i.test(i.uri)) {
                            const response = yield fetch(i.uri);
                            if (!response.ok) {
                                this.missingImagesURIs.push(i.uri);
                                return null;
                            }
                            const imageBlob = yield response.blob();
                            return new NamedBlob(imageBlob, GltfLoader.textureName);
                        }
                        else {
                            const processedFileUri = preprocessUri(i.uri);
                            const imageFile = files.find(file => file.name === processedFileUri);
                            if (!imageFile) {
                                this.missingImagesURIs.push(i.uri);
                                return null;
                            }
                            const imageName = imageFile.name.split("/").pop();
                            return new NamedBlob(imageFile.blob, imageName);
                        }
                    }
                    else {
                        const imageBufferView = gltfJson.bufferViews[i.bufferView];
                        const binaryBuffer = buffers[imageBufferView.buffer];
                        const imageDataView = new DataView(binaryBuffer, imageBufferView.byteOffset, imageBufferView.byteLength);
                        const imageBlob = new Blob([imageDataView], { type: i.mimeType });
                        return new NamedBlob(imageBlob, GltfLoader.textureName);
                    }
                }));
                imageFiles = yield Promise.all(imageFilesPromises);
            }
            return {
                imageFiles,
                buffers
            };
        });
    }
    createImportData(gltfJson, buffers, imageFiles) {
        gltfJson.nodes.forEach(gltfNode => {
            gltfNode.matrix = this.getMatrixForNode(gltfNode);
        });
        gltfJson.accessors.forEach(gltfAccessor => {
            gltfAccessor.byteStride = gltfJson.bufferViews[gltfAccessor.bufferView].byteStride;
        });
        return {
            rootNodeIds: gltfJson.scenes[gltfJson.scene].nodes,
            nodes: gltfJson.nodes,
            meshes: gltfJson.meshes,
            accessors: gltfJson.accessors,
            dataViews: this.createDataViews(gltfJson, buffers)
        };
    }
    createDataViews(gltfJson, buffers) {
        return gltfJson.bufferViews.map(gltfBufferView => {
            const buffer = buffers[gltfBufferView.buffer];
            return new DataView(buffer, gltfBufferView.byteOffset, gltfBufferView.byteLength);
        });
    }
    getMatrixForNode(node) {
        if (node.matrix) {
            return node.matrix;
        }
        else {
            const translation = node.translation || [0, 0, 0];
            const rotation = node.rotation || QuaternionMath.create();
            const scale = node.scale || [1, 1, 1];
            return Mat4Math.fromRotationTranslationScale(translation, rotation, scale);
        }
    }
}
GltfLoader.textureName = "Gltf Import";
GltfLoader.gltfExtension = ".gltf";
GltfLoader.glbExtension = ".glb";
//# sourceMappingURL=gltfLoader.js.map