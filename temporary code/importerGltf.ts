import { ImportData } from "./importData";
import { VctrBufferGeometry } from "../geometry/bufferGeometry";
import { GlTf, MeshPrimitive, Material, Node, TextureInfo, MaterialOcclusionTextureInfo, MaterialNormalTextureInfo } from "./gltfInterface";
import { MaterialInterface } from "../material/materialInterface";
import { MaterialPBR, AlphaMode } from "../material/materialPBR";
import { App } from "../../app/app";
import { TextureConfig } from "../material/TextureConfig";
import { UV_TYPE } from "../geometry/geometryInterface";
import { preprocessUri } from "./importUtils";
import { NamedBlob } from "../../app/api/blobUtils";
import { getImageBlobMimeType } from "../../util/mimeType";


// TODO: Maybe we can use validator.. https://github.com/KhronosGroup/glTF-Validator
// Right now, we just try-catch the errors

export class ImporterGltf {
    static NUMBER_OF_COMPONENTS: Map<string, number> = new Map([
        ["SCALAR", 1],
        ["VEC2", 2],
        ["VEC3", 3],
        ["VEC4", 4],
        ["MAT2", 4],
        ["MAT3", 9],
        ["MAT4", 16]
    ]);
    static COMPONENT_BYTESIZE: Map<number, number> = new Map([
        [5120, 1],
        [5121, 1],
        [5122, 2],
        [5123, 2],
        [5125, 4],
        [5126, 4]
    ]);
    static PRIMITIVE_MODE: Map<number, string> = new Map([
        [0, "POINTS"],
        [1, "LINES"],
        [2, "LINE_LOOP"],
        [3, "LINE_STRIP"],
        [4, "TRIANGLES"],
        [5, "TRIANGLE_STRIP"],
        [6, "TRIANGLE_FAN"]
    ]);

    private static readonly textureName = "Gltf Import";

    unitMeters: number = 0.001;
    textureSourceIdxToId: Map<number, string> = new Map();

    missingImagesURIs: string[] = [];

    async parseBinary(glbAsBuffer: ArrayBuffer, files: NamedBlob[], unitMeters: number): Promise<ImportData[]> {

        this.unitMeters = unitMeters;
        this.textureSourceIdxToId = new Map();
        const glbDataView = new DataView(glbAsBuffer);

        let offset = 0;
        const glbMagicIdentificator = glbDataView.getUint32(offset, true);
        if (glbMagicIdentificator !== 0x46546C67) {
            return Promise.reject(new Error("glb importer: Not a real .glb file"));
        }

        offset += 4;
        const glbVersion = glbDataView.getUint32(offset, true);
        if (glbVersion !== 2) {
            return Promise.reject(new Error("glb importer: Wrong version. It must be 2."));
        }

        offset += 4;
        const overAllGlbSize = glbDataView.getUint32(offset, true);

        offset += 4;
        const jsonChunkSize = glbDataView.getUint32(offset, true);

        offset += 4;
        const jsonChunkType = glbDataView.getUint32(offset, true);
        if (jsonChunkType !== 0x4E4F534A) {
            return Promise.reject(new Error("glb importer: First chunk must be JSON"));
        }

        offset += 4;
        const jsonChunkView = new DataView(glbAsBuffer, offset, jsonChunkSize);
        const gltfJsonAsString = new TextDecoder().decode(jsonChunkView);
        const gltfJson: GlTf = JSON.parse(gltfJsonAsString);

        offset += jsonChunkSize;
        let chunkSize = 0;
        // In almost all of the cases, there's gonna be just one more chunk - binary.
        // But there might be some extensions using more chunks, so I created this loop, just to be sure.
        while (offset < overAllGlbSize) {
            chunkSize = glbDataView.getUint32(offset, true);
            offset += 4;
            const chunkType = glbDataView.getUint32(offset, true);
            const binDataFound = chunkType === 0x004E4942;
            offset += 4;
            if (binDataFound) {
                break;
            } else {
                offset += chunkSize;
            }
        }

        if (offset > overAllGlbSize) {
            // TODO: Is this really an error? What about glb with no geometry and no textures? Is it legal?
            return Promise.reject(new Error("glb importer: Unable to find chunk containing binary buffer"));
        }

        const binaryBuffer = glbAsBuffer.slice(offset, offset + chunkSize);

        const data = await this.loadImagesAndBuffers(gltfJson, files, binaryBuffer);

        try {
            const importData = this.createImportData(gltfJson, data.buffers, data.imageFiles);
            return importData;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    async parseNonBinary(gltfAsBuffer: ArrayBuffer, files: NamedBlob[], unitMeters: number): Promise<ImportData[]> {
        this.unitMeters = unitMeters;
        this.textureSourceIdxToId = new Map();
        let gltfJson: GlTf;

        gltfJson = JSON.parse(new TextDecoder().decode(gltfAsBuffer));

        if (parseInt(gltfJson.asset.version[0]) !== 2) {
            return Promise.reject(new Error("Trying to import gltf version " + gltfJson.asset.version + ". Only versions 2.x are supported."));
        };

        const data = await this.loadImagesAndBuffers(gltfJson, files);

        try {
            const importData = this.createImportData(gltfJson, data.buffers, data.imageFiles);
            return importData;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    private async loadImagesAndBuffers(gltfJson: GlTf, files: NamedBlob[], glbBuffer?: ArrayBuffer): Promise<{ imageFiles: NamedBlob[], buffers: ArrayBuffer[] }> {
        let imageFiles: NamedBlob[];
        let buffers: ArrayBuffer[];

        const bufferFilesPromises = gltfJson.buffers.map(async (b, i) => {
            if (!b.uri) {
                // if the uri is not defined, it must be glb buffer
                return Promise.resolve(glbBuffer);
            }

            // load buffer using uri
            if (/^data:.*,.*$/i.test(b.uri) || /^(https?:)?\/\//i.test(b.uri)) {
                // data uri, or http uri
                const response = await fetch(b.uri);
                if (!response.ok) {
                    return Promise.reject(new Error("File " + b.uri + " not found."));
                }
                return await response.arrayBuffer();

            } else {
                // relative path
                const processedFileUri = preprocessUri(b.uri);
                const fileCandidate = files.find(file => file.name === processedFileUri);

                if (!fileCandidate) {
                    return Promise.reject(new Error("File " + b.uri + " not found."));
                }

                return new Promise<ArrayBuffer>((resolve) => {
                    let reader = new FileReader();
                    reader.onload = () => {
                        resolve(reader.result as ArrayBuffer);
                    };
                    reader.readAsArrayBuffer(fileCandidate.blob);
                });
            }
        });

        buffers = await Promise.all(bufferFilesPromises);

        if (gltfJson.images) {
            const imageFilesPromises = gltfJson.images.map(async (i, idx) => {
                if (i.uri) {
                    // load image using uri
                    if (/^data:.*,.*$/i.test(i.uri) || /^(https?:)?\/\//i.test(i.uri)) {
                        // data uri, or http uri
                        const response = await fetch(i.uri);
                        if (!response.ok) {
                            this.missingImagesURIs.push(i.uri);
                            return null;
                        }
                        const imageBlob = await response.blob();
                        return new NamedBlob(imageBlob, ImporterGltf.textureName);

                    } else {
                        // relative path
                        const processedFileUri = preprocessUri(i.uri);
                        const imageFile = files.find(file => file.name === processedFileUri);

                        if (!imageFile) {
                            this.missingImagesURIs.push(i.uri);
                            return null;
                        }

                        const imageName = imageFile.name.split("/").pop();
                        return new NamedBlob(imageFile.blob, imageName);
                    }

                } else {
                    // load image from binary buffer
                    const imageBufferView = gltfJson.bufferViews[i.bufferView];
                    const binaryBuffer = buffers[imageBufferView.buffer];
                    const imageDataView = new DataView(binaryBuffer, imageBufferView.byteOffset, imageBufferView.byteLength);

                    const imageBlob = new Blob([imageDataView], { type: i.mimeType });
                    return new NamedBlob(imageBlob, ImporterGltf.textureName);
                }
            });

            imageFiles = await Promise.all(imageFilesPromises);
        }

        return {
            imageFiles,
            buffers
        };
    }

    private createImportData(gltfJson: GlTf, buffers: ArrayBuffer[], imageFiles: NamedBlob[]): ImportData[] {
        const resultData: ImportData[] = new Array(gltfJson.nodes.length);

        const materials = this.createMaterials(gltfJson, imageFiles);
        const geometries = this.createGeometries(gltfJson, buffers);

        for (let i = 0; i < gltfJson.nodes.length; i++) {
            let nodeName = gltfJson.nodes[i].name;
            const matrix = this.getMatrixForNode(gltfJson.nodes[i]);

            if (gltfJson.nodes[i].hasOwnProperty("mesh")) {
                const mesh = gltfJson.meshes[gltfJson.nodes[i].mesh];

                const meshGeometries: VctrBufferGeometry[] = [];
                const meshMaterials: MaterialInterface[] = [];

                nodeName = mesh.name ? mesh.name : nodeName;

                for (let j = 0; j < mesh.primitives.length; j++) {
                    const bg = geometries[gltfJson.nodes[i].mesh][j];

                    if (bg) {
                        meshGeometries.push(bg);
                        const material = (mesh.primitives[j].material !== undefined) ? materials[mesh.primitives[j].material] : null;
                        meshMaterials.push(material);
                    }
                }

                if (meshGeometries.length > 1) {
                    // We can't have more geometries per mesh, we split it to more meshes
                    const children = gltfJson.nodes[i].hasOwnProperty("children") ? gltfJson.nodes[i].children.slice() : [];
                    for (let j = 0; j < meshGeometries.length; j++) {
                        resultData.push(new ImportData(meshGeometries[j], meshMaterials[j], new THREE.Matrix4(), null, nodeName));
                        children.push(resultData.length - 1);
                    }

                    resultData[i] = new ImportData(null, null, matrix, children, nodeName);
                } else {
                    resultData[i] = new ImportData(meshGeometries[0], meshMaterials[0], matrix, gltfJson.nodes[i].children, nodeName);
                }
            } else {
                resultData[i] = new ImportData(null, null, matrix, gltfJson.nodes[i].children, nodeName);
            }
        }

        this.setCorrectScaleAndUpvector(gltfJson.scenes[0].nodes, resultData);

        return resultData;
    }

    private createGeometries(gltfJson: GlTf, buffers: ArrayBuffer[]): VctrBufferGeometry[][] {
        // Gltf stores material id and geometry accessors ids in the same object.
        // We do this check to find referenced geometries.
        const geometriesReferToSameData = (p1: MeshPrimitive, p2: MeshPrimitive) => {
            for (let key in p1.attributes) {
                if (p1.attributes[key] !== p2.attributes[key]) {
                    return false;
                }
            }
            for (let key in p1) {
                if ((key !== "material") && (key !== "attributes") && (p1[key] !== p2[key])) {
                    return false;
                }
            }
            return true;
        };

        const resultGeometries: VctrBufferGeometry[][] = [];

        const usedPrimitives: MeshPrimitive[] = [];
        const primitiveToGeometry: Map<MeshPrimitive, VctrBufferGeometry> = new Map();

        for (let i = 0; i < gltfJson.meshes.length; i++) {
            resultGeometries.push([]);

            for (let j = 0; j < gltfJson.meshes[i].primitives.length; j++) {
                let primitive = gltfJson.meshes[i].primitives[j];
                const samePrimitive = usedPrimitives.find(usedPrimitive => geometriesReferToSameData(usedPrimitive, primitive));

                let resultGeometry = samePrimitive ? primitiveToGeometry.get(samePrimitive) : this.bufferGeometryFromPrimitive(gltfJson, buffers, primitive);
                resultGeometries[resultGeometries.length - 1].push(resultGeometry);

                if (!samePrimitive) {
                    usedPrimitives.push(primitive);
                    primitiveToGeometry.set(primitive, resultGeometry);
                }
            }
        }
        return resultGeometries;
    }

    private createMaterials(gltfJson: GlTf, imageFiles: NamedBlob[]): MaterialInterface[] {
        if (gltfJson.materials === undefined) {
            return null;
        }

        const resultMaterials: MaterialInterface[] = new Array(gltfJson.materials.length);

        for (let i = 0; i < gltfJson.materials.length; i++) {
            resultMaterials[i] = this.vctrMaterialFromGltfMaterial(gltfJson, imageFiles, gltfJson.materials[i]);
        }

        return resultMaterials;
    }

    private loadTexture(idx: number, gltfJson: GlTf, imageFiles: NamedBlob[]): string {
        const sourceIdx = gltfJson.textures[idx].source;
        let id = this.textureSourceIdxToId.get(sourceIdx);

        if (id === undefined) {
            const imageFile = imageFiles[sourceIdx];
            if (imageFile) {
                const textures = App.instance.library.getTextures();
                const textureUrl = URL.createObjectURL(imageFile.blob);
                id = textures.cacheTexture(textureUrl, undefined, imageFile.name).id;
            } else {
                id = null;
            }
            this.textureSourceIdxToId.set(sourceIdx, id);
        }
        return id;
    }

    private vctrMaterialFromGltfMaterial(gltfJson: GlTf, imageFiles: NamedBlob[], gltfMaterial: Material): MaterialInterface {
        if (!gltfMaterial.pbrMetallicRoughness) {
            return null;
        }

        let textureExtension: boolean = false;

        if (gltfJson.extensionsUsed) {
            if (gltfJson.extensionsUsed.find(ex => ex === "KHR_texture_transform")) {
                textureExtension = true;
            }
        }

        const textureTransform = (texture: TextureInfo | MaterialOcclusionTextureInfo | MaterialNormalTextureInfo, config: TextureConfig) => {

            if (texture.extensions["KHR_texture_transform"]["offset"] !== undefined) {
                config.mapping.offsetX = texture.extensions["KHR_texture_transform"]["offset"][0];
                config.mapping.offsetY = -texture.extensions["KHR_texture_transform"]["offset"][1]; // the uvs are flipped when importing from gltf
            }

            if (texture.extensions["KHR_texture_transform"]["scale"] !== undefined) {
                config.mapping.repeatX = texture.extensions["KHR_texture_transform"]["scale"][0];
                config.mapping.repeatY = texture.extensions["KHR_texture_transform"]["scale"][1];
            }
        }

        const pmr = gltfMaterial.pbrMetallicRoughness;

        const result = new MaterialPBR();
        if (pmr.baseColorFactor) {
            result.colorValue.set(Math.pow(pmr.baseColorFactor[0], 1.0 / 2.2), Math.pow(pmr.baseColorFactor[1], 1.0 / 2.2), Math.pow(pmr.baseColorFactor[2], 1.0 / 2.2));
            result.opacity = pmr.baseColorFactor[3];
        }
        if (gltfMaterial.emissiveFactor) {
            result.emissionColor.set(gltfMaterial.emissiveFactor[0], gltfMaterial.emissiveFactor[1], gltfMaterial.emissiveFactor[2]);
            result.emissionMultiplier = 1.0;
        }

        result.metalnessValue = (pmr.metallicFactor !== undefined) ? pmr.metallicFactor : 1.0;
        result.roughnessValue = (pmr.roughnessFactor !== undefined) ? pmr.roughnessFactor : 1.0;
        result.ambientOcclusionMultiplier = (gltfMaterial.occlusionTexture && (gltfMaterial.occlusionTexture.strength !== undefined)) ? gltfMaterial.occlusionTexture.strength : 1.0;
        result.normalScale = (gltfMaterial.normalTexture && gltfMaterial.normalTexture.scale !== undefined) ? gltfMaterial.normalTexture.scale : 1.0;

        if (pmr.baseColorTexture) {
            if (gltfMaterial.alphaMode === "BLEND" || gltfMaterial.alphaMode === "MASK" || !gltfMaterial.alphaMode) {
                const imageFile = imageFiles[gltfJson.textures[pmr.baseColorTexture.index].source];
                if (imageFile) {
                    // Split the alpha channel to a separate RGB texture
                    getImageBlobMimeType(imageFile.blob).then(mimeType => {
                        if (mimeType === "image/png") {
                            const textures = App.instance.library.getTextures();
                            const textureCombinator = App.instance.renderer.getTextureCombinator();

                            textures.awaitTexture(result.colorConfig.textureDatabaseID, texture => {
                                const textureName = textures.getTextureName(result.colorConfig.textureDatabaseID);
                                const resultBlob = textureCombinator.getSingleChannelTextureImage(texture, 3);
                                const opacityTextureFileUrl = URL.createObjectURL(resultBlob);
                                result.opacityConfig.textureDatabaseID = textures.cacheTexture(opacityTextureFileUrl, undefined, textureName + " opacity").id;
                            });

                            if (textureExtension && pmr.baseColorTexture.extensions) {
                                textureTransform(pmr.baseColorTexture, result.opacityConfig);
                            }
                        }
                    });
                }
            }

            if (textureExtension && pmr.baseColorTexture.extensions) {
                textureTransform(pmr.baseColorTexture, result.colorConfig);
            }

            result.colorConfig.textureDatabaseID = this.loadTexture(pmr.baseColorTexture.index, gltfJson, imageFiles);
        }
        if (pmr.metallicRoughnessTexture) {
            if (textureExtension && pmr.metallicRoughnessTexture.extensions) {
                textureTransform(pmr.metallicRoughnessTexture, result.metalnessConfig);
                textureTransform(pmr.metallicRoughnessTexture, result.roughnessConfig);
            }
            result.metalnessConfig.textureDatabaseID = this.loadTexture(pmr.metallicRoughnessTexture.index, gltfJson, imageFiles);
            result.roughnessConfig.textureDatabaseID = result.metalnessConfig.textureDatabaseID;
        }
        if (gltfMaterial.normalTexture) {

            if (textureExtension && gltfMaterial.normalTexture.extensions) {
                textureTransform(gltfMaterial.normalTexture, result.normalConfig);
            }
            result.normalConfig.textureDatabaseID = this.loadTexture(gltfMaterial.normalTexture.index, gltfJson, imageFiles);
        }
        if (gltfMaterial.occlusionTexture) {
            if (textureExtension && gltfMaterial.occlusionTexture.extensions) {
                textureTransform(gltfMaterial.occlusionTexture, result.ambientOcclusionConfig);
            }
            result.ambientOcclusionConfig.textureDatabaseID = this.loadTexture(gltfMaterial.occlusionTexture.index, gltfJson, imageFiles);
        }
        if (gltfMaterial.emissiveTexture) {
            if (textureExtension && gltfMaterial.emissiveTexture.extensions) {
                textureTransform(gltfMaterial.emissiveTexture, result.emissionConfig);
            }
            result.emissionConfig.textureDatabaseID = this.loadTexture(gltfMaterial.emissiveTexture.index, gltfJson, imageFiles);
        }

        result.normalFlipY = false;

        if (gltfMaterial.doubleSided !== undefined) {
            result.doubleSided = gltfMaterial.doubleSided;
        }
        if (gltfMaterial.alphaMode !== undefined) {
            result.alphaMode = (gltfMaterial.alphaMode === "MASK" ? AlphaMode.MASK : AlphaMode.BLEND);
        }
        if (gltfMaterial.alphaCutoff !== undefined) {
            result.alphaCutoff = gltfMaterial.alphaCutoff;
        }

        return result;
    }


    private bufferGeometryFromPrimitive(gltfJson: GlTf, buffers: ArrayBuffer[], primitive: MeshPrimitive): VctrBufferGeometry {

        // TODO: Import some more modes? At least points and lines.
        if (primitive.hasOwnProperty("mode") && primitive.mode !== 4) {
            console.log("Trying to import " + ImporterGltf.PRIMITIVE_MODE.get(primitive.mode) + ". We only support " + ImporterGltf.PRIMITIVE_MODE.get(4) + ". . Skipping this mesh.");
            return null;
        }

        let vertices: Float32Array;
        let indices: Uint32Array;
        let normals: Float32Array;
        let uvs: Float32Array;
        let tangents: Float32Array;


        // --------------- Process positions ---------------
        const positionAccessor = gltfJson.accessors[primitive.attributes.POSITION];
        const positionBufferView = gltfJson.bufferViews[positionAccessor.bufferView];
        const positionBuffer = buffers[positionBufferView.buffer];
        const accessorOffset = positionAccessor.byteOffset ? positionAccessor.byteOffset : 0;

        let dataView = new DataView(positionBuffer, accessorOffset + positionBufferView.byteOffset, positionBufferView.length);

        vertices = new Float32Array(positionAccessor.count * 3);

        let pByteStride = positionBufferView.byteStride ? positionBufferView.byteStride : (3 * 4);
        let pIndex = 0;

        for (let i = 0; i < vertices.length; i += 3) {
            vertices[i] = dataView.getFloat32(pIndex, true);
            vertices[i + 1] = dataView.getFloat32(pIndex + 4, true);
            vertices[i + 2] = dataView.getFloat32(pIndex + 8, true);

            pIndex += pByteStride;
        }


        // -------------- Process indices --------------
        if (primitive.hasOwnProperty("indices")) {
            const indexAccessor = gltfJson.accessors[primitive.indices];
            const indexBufferView = gltfJson.bufferViews[indexAccessor.bufferView];
            const indexBuffer = buffers[indexBufferView.buffer];
            const accessorOffset = indexAccessor.byteOffset ? indexAccessor.byteOffset : 0;

            let dataView = new DataView(indexBuffer, accessorOffset + indexBufferView.byteOffset, indexBufferView.length);

            let indexByteLenght: number = ImporterGltf.COMPONENT_BYTESIZE.get(indexAccessor.componentType);

            indices = new Uint32Array(indexAccessor.count);

            let iByteStride = indexBufferView.byteStride ? indexBufferView.byteStride : indexByteLenght;
            let iIndex = 0;

            let getNumber = (iIndex: number) => dataView.getUint32(iIndex, true);
            if (indexByteLenght === 2) {
                getNumber = (iIndex: number) => dataView.getUint16(iIndex, true);
            } else if (indexByteLenght === 1) {
                getNumber = (iIndex: number) => dataView.getUint8(iIndex);
            }

            for (let i = 0; i < indices.length; i++) {
                indices[i] = getNumber(iIndex);
                iIndex += iByteStride;
            }
        }


        // --------------- Process normals ---------------
        if (primitive.attributes.hasOwnProperty("NORMAL")) {
            const normalAccessor = gltfJson.accessors[primitive.attributes.NORMAL];
            const normalBufferView = gltfJson.bufferViews[normalAccessor.bufferView];
            const normalBuffer = buffers[normalBufferView.buffer];
            const accessorOffset = normalAccessor.byteOffset ? normalAccessor.byteOffset : 0;

            dataView = new DataView(normalBuffer, accessorOffset + normalBufferView.byteOffset, normalBufferView.length);

            normals = new Float32Array(normalAccessor.count * 3);

            let nByteStride = normalBufferView.byteStride ? normalBufferView.byteStride : (3 * 4);
            let nIndex = 0;

            for (let i = 0; i < normals.length; i += 3) {
                normals[i] = dataView.getFloat32(nIndex, true);
                normals[i + 1] = dataView.getFloat32(nIndex + 4, true);
                normals[i + 2] = dataView.getFloat32(nIndex + 8, true);

                nIndex += nByteStride;
            }
        }

        // --------------- Process uvs ---------------
        if (primitive.attributes.hasOwnProperty("TEXCOORD_0")) {
            const uvAccessor = gltfJson.accessors[primitive.attributes.TEXCOORD_0];
            const uvBufferView = gltfJson.bufferViews[uvAccessor.bufferView];
            const uvBuffer = buffers[uvBufferView.buffer];
            const accessorOffset = uvAccessor.byteOffset ? uvAccessor.byteOffset : 0;

            dataView = new DataView(uvBuffer, accessorOffset + uvBufferView.byteOffset, uvBufferView.length);

            if (uvAccessor.componentType !== 5126) {
                console.log("Trying to use integer UVs. We only support float. Skipping this mesh.");
                return null;
            }

            uvs = new Float32Array(uvAccessor.count * 2);

            let uvByteStride = uvBufferView.byteStride ? uvBufferView.byteStride : (2 * 4);
            let uvIndex = 0;

            for (let i = 0; i < uvs.length; i += 2) {
                uvs[i] = dataView.getFloat32(uvIndex, true);
                uvs[i + 1] = 1.0 - dataView.getFloat32(uvIndex + 4, true); // gltf has opposite direction of V

                uvIndex += uvByteStride;
            }
        }


        // --------------- Process tangents ---------------
        if (primitive.attributes.hasOwnProperty("TANGENT")) {
            const tangentAccessor = gltfJson.accessors[primitive.attributes.TANGENT];
            const tangentBufferView = gltfJson.bufferViews[tangentAccessor.bufferView];
            const tangentBuffer = buffers[tangentBufferView.buffer];
            const accessorOffset = tangentAccessor.byteOffset ? tangentAccessor.byteOffset : 0;

            dataView = new DataView(tangentBuffer, accessorOffset + tangentBufferView.byteOffset, tangentBufferView.length);

            tangents = new Float32Array(tangentAccessor.count * 4);

            let tByteStride = tangentBufferView.byteStride ? tangentBufferView.byteStride : (4 * 4);
            let tIndex = 0;

            for (let i = 0; i < tangents.length; i += 4) {
                tangents[i] = dataView.getFloat32(tIndex, true);
                tangents[i + 1] = dataView.getFloat32(tIndex + 4, true);
                tangents[i + 2] = dataView.getFloat32(tIndex + 8, true);
                tangents[i + 3] = dataView.getFloat32(tIndex + 12, true);

                tIndex += tByteStride;
            }
        }

        const resultGeometry = new VctrBufferGeometry();
        if (indices) {
            const uvsMap = new Map<UV_TYPE, Float32Array>();
            uvsMap.set(UV_TYPE.TEXCOORD0, uvs);
            resultGeometry.setFromIndexedBuffers(vertices, indices, normals, uvsMap, tangents);

        } else {
            resultGeometry.vertices = vertices;
            resultGeometry.uvs.set(UV_TYPE.TEXCOORD0, uvs);
            resultGeometry.normals = normals;
            resultGeometry.tangents = tangents;
        }

        if (!normals) {
            resultGeometry.computeNormals();
        }

        return resultGeometry;
    }

    private setCorrectScaleAndUpvector(rootNodes: number[], resultData: ImportData[]) {
        let sceneTransformation = new THREE.Matrix4();

        // scale everything -> gltf units are (or - should be) in meters
        const scale = 1 / this.unitMeters;
        sceneTransformation.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));

        // switch upvector to Z
        const upVectorQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        sceneTransformation.multiply(new THREE.Matrix4().makeRotationFromQuaternion(upVectorQuaternion));

        if (rootNodes.length === 1) {
            resultData[rootNodes[0]].transformation.premultiply(sceneTransformation);
            resultData[rootNodes[0]].isRootNode = true;
        } else {
            resultData.push(new ImportData(null, null, sceneTransformation, rootNodes));
            resultData[resultData.length - 1].isRootNode = true;
        }
    }

    private getMatrixForNode(node: Node): THREE.Matrix4 {
        const translation = node.translation ? new THREE.Vector3().fromArray(node.translation) : new THREE.Vector3();
        const rotation = node.rotation ? new THREE.Quaternion().fromArray(node.rotation) : new THREE.Quaternion();
        const scale = node.scale ? new THREE.Vector3().fromArray(node.scale) : new THREE.Vector3(1, 1, 1);

        return node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(translation, rotation, scale);
    }
}
