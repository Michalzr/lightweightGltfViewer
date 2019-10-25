import * as GlTf from "./gltfInterface";
import { NamedBlob, preprocessUri } from "./utils/fileUtils.js";
import * as Mat4Math from "./utils/mathUtils/martix4.js";
import * as Vec3Math from "./utils/mathUtils/vector3.js";
import * as QuaternionMath from "./utils/mathUtils/quaternion.js";
import { fillGltfDefaultValues } from "./gltfPostProcess.js"

// the idea is to use the same structure as gltf, except:
// - bufferViews are DataView objects
// - accessors contain extra property "byteStride" (taken from the bufferView)
// - images are HTMLImageElements
export interface LoadedGltf {
    rootNodeIds: number[];
    nodes?: GlTf.Node[];
    meshes?: GlTf.Mesh[];
    materials?: GlTf.Material[];
    textures?: GlTf.Texture[];
    samplers?: GlTf.Sampler[];
    accessors?: Accessor[];
    dataViews?: DataView[];
    images?: HTMLImageElement[];
}

export interface Accessor extends GlTf.Accessor {
    byteStride?: number;
}


// static NUMBER_OF_COMPONENTS: Map<string, number> = new Map([
//     ["SCALAR", 1],
//     ["VEC2", 2],
//     ["VEC3", 3],
//     ["VEC4", 4],
//     ["MAT2", 4],
//     ["MAT3", 9],
//     ["MAT4", 16]
// ]);

export class GltfLoader {
    private static readonly gltfExtension = ".gltf";
    private static readonly glbExtension = ".glb";

    textureSourceIdxToId: Map<number, string> = new Map();

    async load(files: NamedBlob[]): Promise<LoadedGltf>  {
        const gltfFile = files.find(f => f.name.endsWith(GltfLoader.gltfExtension) || f.name.endsWith(GltfLoader.glbExtension));
    
        if (!gltfFile) {
            window.alert("No \".gltf\" or \".glb\" file found.");
            return;
        }
    
        const loadedGltf = gltfFile.name.endsWith(GltfLoader.gltfExtension) ?
            await this.parseNonBinary(gltfFile, files) :
            await this.parseBinary(gltfFile, files);
        
        fillGltfDefaultValues(loadedGltf);

        this.fitToView(loadedGltf);

        return loadedGltf;
    }

    private async parseBinary(glb: NamedBlob, files: NamedBlob[]): Promise<LoadedGltf> {

        this.textureSourceIdxToId = new Map();

        const glbAsBuffer = await new Response(glb.blob).arrayBuffer();
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
        const gltfJson: GlTf.GlTf = JSON.parse(gltfJsonAsString);

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
            return Promise.reject(new Error("Unable to find chunk containing binary buffer"));
        }

        const binaryBuffer = glbAsBuffer.slice(offset, offset + chunkSize);

        const data = await this.loadImagesAndBuffers(gltfJson, files, binaryBuffer);

        return this.createImportData(gltfJson, data.buffers, data.images);
    }

    private async parseNonBinary(gltf: NamedBlob, files: NamedBlob[]): Promise<LoadedGltf> {
        this.textureSourceIdxToId = new Map();

        const gltfString = await new Response(gltf.blob).text();
        const gltfJson: GlTf.GlTf = JSON.parse(gltfString);

        if (parseInt(gltfJson.asset.version[0]) !== 2) {
            return Promise.reject(new Error("Wrong gltf version. It must be 2."));
        };

        const data = await this.loadImagesAndBuffers(gltfJson, files);

        return this.createImportData(gltfJson, data.buffers, data.images);
    }

    private async loadImagesAndBuffers(gltfJson: GlTf.GlTf, files: NamedBlob[], glbBuffer?: ArrayBuffer): Promise<{ images: HTMLImageElement[], buffers: ArrayBuffer[] }> {
        let images: HTMLImageElement[];
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

                return new Response(fileCandidate.blob).arrayBuffer();
            }
        });

        buffers = await Promise.all(bufferFilesPromises);

        if (gltfJson.images) {
            const imageFilesPromises: Promise<HTMLImageElement>[] = gltfJson.images.map(async (i, idx) => {
                let url = "";

                if (i.uri) {
                    // load image using uri
                    if (/^data:.*,.*$/i.test(i.uri) || /^(https?:)?\/\//i.test(i.uri)) {
                        url = i.uri;

                    } else {
                        // relative path
                        const processedFileUri = preprocessUri(i.uri);
                        const imageFile = files.find(file => file.name === processedFileUri);

                        if (!imageFile) { return Promise.reject("Image file " + i.uri + " not found.");}

                        url = URL.createObjectURL(imageFile.blob);
                    }

                } else {
                    // load image from binary buffer
                    const imageBufferView = gltfJson.bufferViews[i.bufferView];
                    const binaryBuffer = buffers[imageBufferView.buffer];
                    const imageDataView = new DataView(binaryBuffer, imageBufferView.byteOffset, imageBufferView.byteLength);

                    url = URL.createObjectURL(new Blob([imageDataView], { type: i.mimeType }));
                }

                const image = new Image();
                
                return new Promise<HTMLImageElement>((resolve, reject) => {
                    image.addEventListener('load', () => {
                        resolve(image);
                    });
                    image.src = url;
                });
            });

            images = await Promise.all(imageFilesPromises);
        }

        return {
            images,
            buffers
        };
    }

    private createImportData(gltfJson: GlTf.GlTf, buffers: ArrayBuffer[], images: HTMLImageElement[]): LoadedGltf {
        // move "byteStride" from BufferView to Accessor
        gltfJson.accessors.forEach(gltfAccessor => {
            gltfAccessor.byteStride = gltfJson.bufferViews[gltfAccessor.bufferView].byteStride;
        });

        return {
            rootNodeIds: gltfJson.scenes[gltfJson.scene].nodes,
            nodes: gltfJson.nodes,
            meshes: gltfJson.meshes,
            materials: gltfJson.materials,
            textures: gltfJson.textures,
            samplers: gltfJson.samplers,
            images: images,
            accessors: gltfJson.accessors as Accessor[],
            dataViews: this.createDataViews(gltfJson, buffers)
        }
    }

    private createDataViews(gltfJson: GlTf.GlTf, buffers: ArrayBuffer[]): DataView[] {
        return gltfJson.bufferViews.map(gltfBufferView => {
            const buffer = buffers[gltfBufferView.buffer];
            return new DataView(buffer, gltfBufferView.byteOffset, gltfBufferView.byteLength);
        });
    }

    private fitToView(loadedGltf: LoadedGltf): void {
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

            const scale = Vec3Math.multiplyScalar([1, 1, 1], 1 / maxSize);
            const translate = Vec3Math.multiply(Vec3Math.negate(center), scale);
            const rotate = QuaternionMath.create();

            const fitMatrix = Mat4Math.fromTranslationRotationScale(translate, rotate, scale);

            loadedGltf.rootNodeIds.forEach(nodeId => {
                loadedGltf.nodes[nodeId].matrix = Mat4Math.multiply(fitMatrix, loadedGltf.nodes[nodeId].matrix as Mat4Math.Mat4);
            })
        }
    }








    // ---------------- old shit
    // private loadTexture(idx: number, gltfJson: GlTf.GlTf, imageFiles: NamedBlob[]): string {
    //     const sourceIdx = gltfJson.textures[idx].source;
    //     let id = this.textureSourceIdxToId.get(sourceIdx);

    //     if (id === undefined) {
    //         const imageFile = imageFiles[sourceIdx];
    //         if (imageFile) {
    //             const textures = App.instance.library.getTextures();
    //             const textureUrl = URL.createObjectURL(imageFile.blob);
    //             id = textures.cacheTexture(textureUrl, undefined, imageFile.name).id;
    //         } else {
    //             id = null;
    //         }
    //         this.textureSourceIdxToId.set(sourceIdx, id);
    //     }
    //     return id;
    // }

    // private vctrMaterialFromGltfMaterial(gltfJson: GlTf.GlTf, imageFiles: NamedBlob[], gltfMaterial: GlTf.Material): MaterialInterface {
    //     if (!gltfMaterial.pbrMetallicRoughness) {
    //         return null;
    //     }

    //     let textureExtension: boolean = false;

    //     if (gltfJson.extensionsUsed) {
    //         if (gltfJson.extensionsUsed.find(ex => ex === "KHR_texture_transform")) {
    //             textureExtension = true;
    //         }
    //     }

    //     const textureTransform = (texture: GlTf.TextureInfo | GlTf.MaterialOcclusionTextureInfo | GlTf.MaterialNormalTextureInfo, config: TextureConfig) => {

    //         if (texture.extensions["KHR_texture_transform"]["offset"] !== undefined) {
    //             config.mapping.offsetX = texture.extensions["KHR_texture_transform"]["offset"][0];
    //             config.mapping.offsetY = -texture.extensions["KHR_texture_transform"]["offset"][1]; // the uvs are flipped when importing from gltf
    //         }

    //         if (texture.extensions["KHR_texture_transform"]["scale"] !== undefined) {
    //             config.mapping.repeatX = texture.extensions["KHR_texture_transform"]["scale"][0];
    //             config.mapping.repeatY = texture.extensions["KHR_texture_transform"]["scale"][1];
    //         }
    //     }

    //     const pmr = gltfMaterial.pbrMetallicRoughness;

    //     const result = new MaterialPBR();
    //     if (pmr.baseColorFactor) {
    //         result.colorValue.set(Math.pow(pmr.baseColorFactor[0], 1.0 / 2.2), Math.pow(pmr.baseColorFactor[1], 1.0 / 2.2), Math.pow(pmr.baseColorFactor[2], 1.0 / 2.2));
    //         result.opacity = pmr.baseColorFactor[3];
    //     }
    //     if (gltfMaterial.emissiveFactor) {
    //         result.emissionColor.set(gltfMaterial.emissiveFactor[0], gltfMaterial.emissiveFactor[1], gltfMaterial.emissiveFactor[2]);
    //         result.emissionMultiplier = 1.0;
    //     }

    //     result.metalnessValue = (pmr.metallicFactor !== undefined) ? pmr.metallicFactor : 1.0;
    //     result.roughnessValue = (pmr.roughnessFactor !== undefined) ? pmr.roughnessFactor : 1.0;
    //     result.ambientOcclusionMultiplier = (gltfMaterial.occlusionTexture && (gltfMaterial.occlusionTexture.strength !== undefined)) ? gltfMaterial.occlusionTexture.strength : 1.0;
    //     result.normalScale = (gltfMaterial.normalTexture && gltfMaterial.normalTexture.scale !== undefined) ? gltfMaterial.normalTexture.scale : 1.0;

    //     if (pmr.baseColorTexture) {
    //         if (gltfMaterial.alphaMode === "BLEND" || gltfMaterial.alphaMode === "MASK" || !gltfMaterial.alphaMode) {
    //             const imageFile = imageFiles[gltfJson.textures[pmr.baseColorTexture.index].source];
    //             if (imageFile) {
    //                 // Split the alpha channel to a separate RGB texture
    //                 getImageBlobMimeType(imageFile.blob).then(mimeType => {
    //                     if (mimeType === "image/png") {
    //                         const textures = App.instance.library.getTextures();
    //                         const textureCombinator = App.instance.renderer.getTextureCombinator();

    //                         textures.awaitTexture(result.colorConfig.textureDatabaseID, texture => {
    //                             const textureName = textures.getTextureName(result.colorConfig.textureDatabaseID);
    //                             const resultBlob = textureCombinator.getSingleChannelTextureImage(texture, 3);
    //                             const opacityTextureFileUrl = URL.createObjectURL(resultBlob);
    //                             result.opacityConfig.textureDatabaseID = textures.cacheTexture(opacityTextureFileUrl, undefined, textureName + " opacity").id;
    //                         });

    //                         if (textureExtension && pmr.baseColorTexture.extensions) {
    //                             textureTransform(pmr.baseColorTexture, result.opacityConfig);
    //                         }
    //                     }
    //                 });
    //             }
    //         }

    //         if (textureExtension && pmr.baseColorTexture.extensions) {
    //             textureTransform(pmr.baseColorTexture, result.colorConfig);
    //         }

    //         result.colorConfig.textureDatabaseID = this.loadTexture(pmr.baseColorTexture.index, gltfJson, imageFiles);
    //     }
    //     if (pmr.metallicRoughnessTexture) {
    //         if (textureExtension && pmr.metallicRoughnessTexture.extensions) {
    //             textureTransform(pmr.metallicRoughnessTexture, result.metalnessConfig);
    //             textureTransform(pmr.metallicRoughnessTexture, result.roughnessConfig);
    //         }
    //         result.metalnessConfig.textureDatabaseID = this.loadTexture(pmr.metallicRoughnessTexture.index, gltfJson, imageFiles);
    //         result.roughnessConfig.textureDatabaseID = result.metalnessConfig.textureDatabaseID;
    //     }
    //     if (gltfMaterial.normalTexture) {

    //         if (textureExtension && gltfMaterial.normalTexture.extensions) {
    //             textureTransform(gltfMaterial.normalTexture, result.normalConfig);
    //         }
    //         result.normalConfig.textureDatabaseID = this.loadTexture(gltfMaterial.normalTexture.index, gltfJson, imageFiles);
    //     }
    //     if (gltfMaterial.occlusionTexture) {
    //         if (textureExtension && gltfMaterial.occlusionTexture.extensions) {
    //             textureTransform(gltfMaterial.occlusionTexture, result.ambientOcclusionConfig);
    //         }
    //         result.ambientOcclusionConfig.textureDatabaseID = this.loadTexture(gltfMaterial.occlusionTexture.index, gltfJson, imageFiles);
    //     }
    //     if (gltfMaterial.emissiveTexture) {
    //         if (textureExtension && gltfMaterial.emissiveTexture.extensions) {
    //             textureTransform(gltfMaterial.emissiveTexture, result.emissionConfig);
    //         }
    //         result.emissionConfig.textureDatabaseID = this.loadTexture(gltfMaterial.emissiveTexture.index, gltfJson, imageFiles);
    //     }

    //     result.normalFlipY = false;

    //     if (gltfMaterial.doubleSided !== undefined) {
    //         result.doubleSided = gltfMaterial.doubleSided;
    //     }
    //     if (gltfMaterial.alphaMode !== undefined) {
    //         result.alphaMode = (gltfMaterial.alphaMode === "MASK" ? AlphaMode.MASK : AlphaMode.BLEND);
    //     }
    //     if (gltfMaterial.alphaCutoff !== undefined) {
    //         result.alphaCutoff = gltfMaterial.alphaCutoff;
    //     }

    //     return result;
    // }
}
