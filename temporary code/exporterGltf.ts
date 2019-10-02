import { Exporter } from "./exporterInterface";
import { ExportHeaderData } from "../exportData/exportHeaderData";
import { ExportMeshData, ExportGeometryData } from "../exportData/exportMeshData";
import { ExportCameraData } from "../exportData/exportCameraData";
import { ExportMaterialData, ExportMaterialDataPBR, ExportTextureConfig } from "../exportData/exportMaterialData";
import { GlTf, Scene, Node, Mesh, Material, Image, Texture, BufferView, Sampler, Camera, Light } from "../../import/gltfInterface";
import * as mimeTypeUtil from "../../../util/mimeType";
import { ExportLightData } from "../exportData/exportLightData";
import { ExportObjectData } from "../exportData/exportObjectData";
import { NamedBlob } from "../../../app/api/blobUtils";
import { GltfOptions } from "../exportSettings";

declare const DracoEncoderModule: any;

const WEBGL_CONSTANTS = {
    POINTS: 0x0000,
    LINES: 0x0001,
    LINE_LOOP: 0x0002,
    LINE_STRIP: 0x0003,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    TRIANGLE_FAN: 0x0006,

    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_SHORT: 0x1403,
    FLOAT: 0x1406,
    UNSIGNED_INT: 0x1405,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,

    NEAREST: 0x2600,
    LINEAR: 0x2601,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    LINEAR_MIPMAP_LINEAR: 0x2703
};

interface AccessorCache {
    indices: number;
    positions: number;
    normals: number;
    uvsDefault: number;
    uvsBaked: number;
    dracoBufferView?: number;
}

export class ExporterGltf implements Exporter {

    unitMeters: number = 0.001;
    projectName: string = "scene0";
    dataArrays: (ArrayBuffer | Blob)[];
    images: Blob[]; // filled only in case of non-binary (glb === false) export
    imageUrlToImageIdx: Map<string, number>;
    overallByteLength: number = 0;
    glb: boolean = true;
    indexed: boolean = true;
    compression: boolean = false;
    lightMap: boolean = false;
    additionalLights: boolean = false;
    materialIdToGltfMaterialIdx: Map<string, number> = new Map();
    geometryIdToGltfGeometryAccessors: Map<string, AccessorCache> = new Map();
    dracoByteOffset: number = 0;
    isEmbed: boolean = false;

    constructor(glb: boolean = true, indexed: boolean = true, options: GltfOptions) {
        this.glb = glb;
        this.indexed = indexed;

        this.compression = options.compression;
        this.lightMap = options.lightMap;
        this.additionalLights = options.additionalLights;
        this.isEmbed = options.isEmbed;
    };

    export(headerData: ExportHeaderData,
        objectData: ExportObjectData[],
        materialData: ExportMaterialData[],
        textureData: Map<string, { file: Blob, mimeType: string }>
    ): NamedBlob[] {
        this.unitMeters = headerData.unitMeters;
        this.projectName = headerData.project;

        this.dataArrays = [];
        this.images = [];
        this.overallByteLength = 0;
        this.imageUrlToImageIdx = new Map();

        // this will also fill dataArrays and overallByteLength..
        const outputJSON = this.getOutputJSON(objectData, materialData, textureData);

        // Generate buffer
        const dataBufferAsBlob = new Blob(this.dataArrays, {type: "application/octet-stream"}); // this is already aligned to a 4-byte boundary
        const bufferFileName = this.glb ? undefined : headerData.project.replace(" ", "") + ".bin";

        outputJSON.buffers = [{
            byteLength: dataBufferAsBlob.size,
            uri: bufferFileName
        }];

        const result: NamedBlob[] = [];

        if (this.glb) {
            const jsonAsBlob: Blob = this.alignTo4ByteBoundary(new Blob([JSON.stringify(outputJSON)]), 0x20);
            const glbSize = 12 + 8 + jsonAsBlob.size + 8 + dataBufferAsBlob.size;

            const resultGlbDataArrays: (ArrayBuffer | Blob)[] = [];
            resultGlbDataArrays.push(new Uint32Array([0x46546C67, 2, glbSize]).buffer); // header
            resultGlbDataArrays.push(new Uint32Array([jsonAsBlob.size, 0x4E4F534A]).buffer); // json chunk info
            resultGlbDataArrays.push(jsonAsBlob); // json chunk data
            resultGlbDataArrays.push(new Uint32Array([dataBufferAsBlob.size, 0x004E4942]).buffer); // data buffer chunk info
            resultGlbDataArrays.push(dataBufferAsBlob); // data buffer chunk data

            result.push(new NamedBlob(
                new Blob(resultGlbDataArrays, {type: this.getMimeType()}),
                headerData.project + "." + this.getExtension()
            ));
        } else {
            result.push(new NamedBlob(
                new Blob([JSON.stringify(outputJSON)], {type: this.getMimeType()}),
                headerData.project + "." + this.getExtension()
            ));

            result.push(new NamedBlob(
                dataBufferAsBlob,
                bufferFileName
            ));

            this.images.forEach((imageBlob, i) => {
                result.push(new NamedBlob(
                    imageBlob,
                    outputJSON.images[i].uri
                ));
            });
        }

        return result;
    }

    private processIndices(gd: ExportGeometryData) {
        let uvsAndVerticesShareIndices: boolean = true;

        for (let i = 0; i < gd.faceData.length; i++) {
            if (gd.faceData[i] !== gd.uvDefaultFaceData[i]) {
                uvsAndVerticesShareIndices = false;
                break;
            }
        }

        if (uvsAndVerticesShareIndices) {
            // normals need to use the same indices as uvs and vertices. We make sure of that
            const vertexIdxToNormals: THREE.Vector3[][] = new Array(gd.vertexData.length / 3);
            for (let i = 0; i < vertexIdxToNormals.length; i++) {
                vertexIdxToNormals[i] = [];
            }
            for (let i = 0; i < gd.faceData.length; i++) {
                const idx = gd.faceNormalData[i] * 3;
                const normal = new THREE.Vector3(gd.normalData[idx], gd.normalData[idx + 1], gd.normalData[idx + 2]);
                vertexIdxToNormals[gd.faceData[i]].push(normal);
            }
            gd.normalData = [];
            for (let i = 0; i < vertexIdxToNormals.length; i++) {
                const avgNormal = vertexIdxToNormals[i].reduce((accumulator, normal) => accumulator.add(normal));
                avgNormal.normalize();
                gd.normalData.push(avgNormal.x, avgNormal.y, avgNormal.z);
            }
            gd.faceNormalData = gd.faceData;

        } else {
            // Indices are useless in this case, but we export them anyway
            const newVertexData: number[] = [];
            const newNormalData: number[] = [];
            const newUvDefaultData: number[] = [];
            const newUvBakedData: number[] = [];

            gd.faceData.forEach(vIdx => {
                for (let i = 0; i < 3; i++) {
                    newVertexData.push(gd.vertexData[vIdx * 3 + i]);
                }
            });
            gd.faceNormalData.forEach(nIdx => {
                for (let i = 0; i < 3; i++) {
                    newNormalData.push(gd.normalData[nIdx * 3 + i]);
                }
            });
            gd.uvDefaultFaceData.forEach(uvIdx => {
                for (let i = 0; i < 2; i++) {
                    newUvDefaultData.push(gd.uvDefaultVertexData[uvIdx * 2 + i]);
                }
            });
            gd.uvBakedFaceData.forEach(uvIdx => {
                for (let i = 0; i < 2; i++) {
                    newUvBakedData.push(gd.uvBakedVertexData[uvIdx * 2 + i]);
                }
            });

            gd.vertexData = newVertexData;
            gd.normalData = newNormalData;
            gd.uvDefaultVertexData = newUvDefaultData;
            gd.uvBakedVertexData = newUvBakedData;
            gd.faceData = gd.faceData.map((f, i) => i);
        }
    }

    private generateFakeIndices(gd: ExportGeometryData) {
        gd.faceData = new Array(gd.vertexData.length / 3);
        for (let i = 0; i < gd.faceData.length; i++) {
            gd.faceData[i] = i;
        }
    }

    private processCamera(cameraData: ExportCameraData, outputJSON: GlTf): number {
        if (!outputJSON.cameras) {
            outputJSON.cameras = [];
        }

        let gltfCamera: Camera = {
            name: cameraData.name,
            type: cameraData.type,
            extras: { targetDistance: cameraData.targetDistance * this.unitMeters }
        }

        if (cameraData.perspectiveSettings) {
            gltfCamera.perspective = {
                aspectRatio: cameraData.perspectiveSettings.aspectRatio,
                yfov: cameraData.perspectiveSettings.yFov,
                zfar: cameraData.perspectiveSettings.zFar * this.unitMeters,
                znear: cameraData.perspectiveSettings.zNear * this.unitMeters
            }
            outputJSON.cameras.push(gltfCamera);
        } else if (cameraData.orthographicSettings) {
            gltfCamera.orthographic = {
                xmag: cameraData.orthographicSettings.xMag * this.unitMeters,
                ymag: cameraData.orthographicSettings.yMag * this.unitMeters,
                zfar: cameraData.orthographicSettings.zFar * this.unitMeters,
                znear: cameraData.orthographicSettings.zNear * this.unitMeters
            }
            outputJSON.cameras.push(gltfCamera);
        }

        return outputJSON.cameras.length - 1;
    }

    private processLight(lightData: ExportLightData, outputJSON: GlTf): number {
        let gltfLight: Light = {
            name: lightData.name,
            type: lightData.type,
            intensity: lightData.intensity,
            range: (lightData.range === null ? undefined : lightData.range),
            color: lightData.color.toArray(),
        }

        if ((lightData.hemisphere || lightData.rectangle || lightData.tube)) {
            if (this.additionalLights) {
                if (lightData.type === "hemisphere") {
                    gltfLight.hemisphere = {
                        colorUp: lightData.hemisphere.colorUp,
                        colorDown: lightData.hemisphere.colorDown,
                        intensityUp: lightData.hemisphere.intensityUp,
                        intensityDown: lightData.hemisphere.intensityDown
                    }
                }

                if (lightData.type === "rectangle") {
                    gltfLight.rectangle = {
                        size: lightData.rectangle.size
                    }
                }

                if (lightData.type === "tube") {
                    gltfLight.tube = {
                        length: lightData.tube.length,
                        thickness: lightData.tube.thickness
                    }
                }

                if (!outputJSON.extensions) {
                    outputJSON.extensions = {}
                }
                if (!outputJSON.extensions["VCTR_lights"]) {
                    outputJSON.extensions["VCTR_lights"] = { lights: [] };
                }
                outputJSON.extensions["VCTR_lights"].lights.push(gltfLight);
                return outputJSON.extensions.VCTR_lights.lights.length - 1;

            } else {
                return -1;
            }

        } else {
            if (lightData.type === "spot") {
                gltfLight.spot = {
                    innerConeAngle: lightData.spot.innerConeAngle * (Math.PI / 180),
                    outerConeAngle: lightData.spot.outerConeAngle * (Math.PI / 180)
                }
            }

            if (!outputJSON.extensions) {
                outputJSON.extensions = {}
            }
            if (!outputJSON.extensions["KHR_lights_punctual"]) {
                outputJSON.extensions["KHR_lights_punctual"] = { lights: [] };
            }
            outputJSON.extensions["KHR_lights_punctual"].lights.push(gltfLight);
            return outputJSON.extensions.KHR_lights_punctual.lights.length - 1;
        }
    }

    private processMesh(meshData: ExportMeshData, materialData: ExportMaterialData[], textureData: Map<string, { file: Blob, mimeType: string }>, outputJSON: GlTf): number {
        let gltfMesh: Mesh = {
            primitives: [
                {
                    mode: WEBGL_CONSTANTS.TRIANGLES,
                    attributes: {}
                }
            ]
        };

        if (this.compression) {
            gltfMesh.primitives[0].extensions = {
                "KHR_draco_mesh_compression": {
                    attributes: {}
                }
            }
        }

        const materialIdx = this.getMaterialIdx(meshData.getMaterialId(), materialData, textureData, outputJSON);
        if (materialIdx >= 0) {
            gltfMesh.primitives[0].material = materialIdx;
        }

        let cachedAccessors = this.geometryIdToGltfGeometryAccessors.get(meshData.geometry.getDatabaseId());

        if (cachedAccessors) {
            gltfMesh.primitives[0].attributes["POSITION"] = cachedAccessors.positions;
            if (cachedAccessors.indices !== undefined) {
                gltfMesh.primitives[0].indices = cachedAccessors.indices;
            }
            if (cachedAccessors.normals !== undefined) {
                gltfMesh.primitives[0].attributes["NORMAL"] = cachedAccessors.normals;
            }
            if (cachedAccessors.uvsDefault !== undefined) {
                gltfMesh.primitives[0].attributes["TEXCOORD_0"] = cachedAccessors.uvsDefault;
            }
            if (cachedAccessors.uvsBaked !== undefined) {
                gltfMesh.primitives[0].attributes["TEXCOORD_1"] = cachedAccessors.uvsBaked;
            }
            if (this.compression) {
                gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["POSITION"] = 0;
                gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["NORMAL"] = 1;
                gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["TEXCOORD_0"] = 2;
                gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["TEXCOORD_1"] = 3;
                gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].bufferView = cachedAccessors.dracoBufferView;
            }

        } else {
            let geometryData: ExportGeometryData;

            if (this.indexed) {
                geometryData = meshData.getIndexedGeometryData(true, true);
                // gltf allows only one set of indices, we need to further process ExportGeometryData
                this.processIndices(geometryData);
            } else {
                geometryData = meshData.getNonIndexedGeometryDataTrianglesOnly(true, true, true);
                // TODO: remove when facebook starts supporting non-indexed geometry
                this.generateFakeIndices(geometryData);
            }

            if (geometryData.vertexData.length === 0) {
                return -1;
            }

            if (!outputJSON.meshes) {
                outputJSON.meshes = [];
            }

            if (!outputJSON.accessors) {
                outputJSON.accessors = [];
            }

            if (!outputJSON.bufferViews) {
                outputJSON.bufferViews = [];
            }

            let byteLength: number;

            // ---------- DRACO COMPRESSION See: https://github.com/google/draco#javascript-encoder-api
            if (this.compression) {
                const encoderModule = new DracoEncoderModule();
                const encoder = new encoderModule.Encoder();
                const meshBuilder = new encoderModule.MeshBuilder();
                const dracoMesh = new encoderModule.Mesh();

                const indices = new Uint32Array(geometryData.faceData);
                const vertices = new Float32Array(geometryData.vertexData);
                const normals = new Float32Array(geometryData.normalData);
                const texcoords0 = new Float32Array(geometryData.uvDefaultVertexData);
                const texcoords1 = new Float32Array(geometryData.uvBakedFaceData);

                const numFaces = indices.length / 3;
                const numPoints = vertices.length;

                meshBuilder.AddFacesToMesh(dracoMesh, numFaces, indices);
                meshBuilder.AddFloatAttributeToMesh(dracoMesh, encoderModule.POSITION, numPoints, 3, vertices);
                meshBuilder.AddFloatAttributeToMesh(dracoMesh, encoderModule.NORMAL, numPoints, 3, normals);
                meshBuilder.AddFloatAttributeToMesh(dracoMesh, encoderModule.TEX_COORD, numPoints, 2, texcoords0);
                meshBuilder.AddFloatAttributeToMesh(dracoMesh, encoderModule.TEX_COORD, numPoints, 2, texcoords1);

                encoder.SetSpeedOptions(5, 5);
                encoder.SetAttributeQuantization(encoderModule.POSITION, 14);
                encoder.SetAttributeQuantization(encoderModule.NORMAL, 14);
                encoder.SetAttributeQuantization(encoderModule.TEX_COORD, 14);
                encoder.SetEncodingMethod(encoderModule.MESH_EDGEBREAKER_ENCODING);

                const encodedData = new encoderModule.DracoInt8Array();
                const encodedLen = encoder.EncodeMeshToDracoBuffer(dracoMesh, encodedData);

                // INDICES
                const indicesCount = geometryData.faceData.length;
                if (indicesCount > 0) {
                    const gltfIndicesAccessor = {
                        componentType: WEBGL_CONSTANTS.UNSIGNED_INT,
                        count: indicesCount,
                        type: "SCALAR"
                    };

                    outputJSON.accessors.push(gltfIndicesAccessor);
                    gltfMesh.primitives[0].indices = outputJSON.accessors.length - 1;
                }

                // VERTICES
                const vertexCount = geometryData.vertexData.length / 3;
                const min = [Infinity, Infinity, Infinity];
                const max = [-Infinity, -Infinity, -Infinity];
                for (let i = 0; i < geometryData.vertexData.length; i += 3) {
                    min[0] = Math.min(min[0], geometryData.vertexData[i]);
                    min[1] = Math.min(min[1], geometryData.vertexData[i + 1]);
                    min[2] = Math.min(min[2], geometryData.vertexData[i + 2]);

                    max[0] = Math.max(max[0], geometryData.vertexData[i]);
                    max[1] = Math.max(max[1], geometryData.vertexData[i + 1]);
                    max[2] = Math.max(max[2], geometryData.vertexData[i + 2]);
                }

                const gltfVertexAccessor = {
                    componentType: WEBGL_CONSTANTS.FLOAT,
                    count: vertexCount,
                    max: max,
                    min: min,
                    type: "VEC3"
                };

                outputJSON.accessors.push(gltfVertexAccessor);
                gltfMesh.primitives[0].attributes["POSITION"] = outputJSON.accessors.length - 1;
                gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["POSITION"] = 0;


                // NORMALS
                const normalsCount = geometryData.normalData.length / 3;
                if (normalsCount === vertexCount) {
                    const gltfNormalAccessor = {
                        componentType: WEBGL_CONSTANTS.FLOAT,
                        count: normalsCount,
                        type: "VEC3"
                    };

                    outputJSON.accessors.push(gltfNormalAccessor);
                    gltfMesh.primitives[0].attributes["NORMAL"] = outputJSON.accessors.length - 1;
                    gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["NORMAL"] = 1;

                }

                // UVS
                const uvsCountDefault = geometryData.uvDefaultVertexData.length / 2;
                if (uvsCountDefault === vertexCount) {
                    const gltfUVAccessor = {
                        componentType: WEBGL_CONSTANTS.FLOAT,
                        count: uvsCountDefault,
                        type: "VEC2"
                    };

                    outputJSON.accessors.push(gltfUVAccessor);
                    gltfMesh.primitives[0].attributes["TEXCOORD_0"] = outputJSON.accessors.length - 1;
                    gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["TEXCOORD_0"] = 2;
                }

                const uvsCountBaked = geometryData.uvBakedVertexData.length / 2;
                if (uvsCountBaked === vertexCount) {
                    const gltfUVAccessor = {
                        componentType: WEBGL_CONSTANTS.FLOAT,
                        count: uvsCountBaked,
                        type: "VEC2"
                    };

                    outputJSON.accessors.push(gltfUVAccessor);
                    gltfMesh.primitives[0].attributes["TEXCOORD_1"] = outputJSON.accessors.length - 1;
                    gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].attributes["TEXCOORD_1"] = 2;
                }

                const bufferView = {
                    buffer: 0,
                    byteOffset: this.dracoByteOffset,
                    byteLength: encodedLen
                };
                outputJSON.bufferViews.push(bufferView);
                gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].bufferView = outputJSON.bufferViews.length - 1;

                this.cacheAccesors(cachedAccessors, meshData, gltfMesh);

                if (encodedLen > 0) {
                    console.log("Encoded size is " + encodedLen);
                } else {
                    console.log("Error: Encoding failed.");
                }

                const outputBuffer = new ArrayBuffer(encodedLen);
                const outputData = new Int8Array(outputBuffer);
                for (let i = 0; i < encodedLen; ++i) {
                    outputData[i] = encodedData.GetValue(i);
                }

                this.dataArrays.push(outputBuffer);

                this.dracoByteOffset = bufferView.byteOffset + bufferView.byteLength;

                encoderModule.destroy(dracoMesh);
                encoderModule.destroy(encoder);
                encoderModule.destroy(meshBuilder);
            } else {

                // ---------- BUFFER FOR INDICES
                const indicesCount = geometryData.faceData.length;

                byteLength = indicesCount * 4;
                if (indicesCount > 0) {
                    this.dataArrays.push(new Uint32Array(geometryData.faceData).buffer);
                    const gltfIndicesBufferView = {
                        buffer: 0,
                        byteOffset: this.overallByteLength,
                        byteLength: byteLength,
                        target: WEBGL_CONSTANTS.ELEMENT_ARRAY_BUFFER
                    };
                    this.overallByteLength += byteLength;

                    const gltfIndicesAccessor = {
                        bufferView: outputJSON.bufferViews.length,
                        byteOffset: 0,
                        componentType: WEBGL_CONSTANTS.UNSIGNED_INT,
                        count: indicesCount,
                        type: "SCALAR"
                    };

                    outputJSON.bufferViews.push(gltfIndicesBufferView);
                    outputJSON.accessors.push(gltfIndicesAccessor);
                    gltfMesh.primitives[0].indices = outputJSON.accessors.length - 1;
                }



                // ------------ VERTEX BUFFER
                const vertexCount = geometryData.vertexData.length / 3;

                byteLength = geometryData.vertexData.length * 4;
                this.dataArrays.push(new Float32Array(geometryData.vertexData).buffer);

                const min = [Infinity, Infinity, Infinity];
                const max = [-Infinity, -Infinity, -Infinity];
                for (let i = 0; i < geometryData.vertexData.length; i += 3) {
                    min[0] = Math.min(min[0], geometryData.vertexData[i]);
                    min[1] = Math.min(min[1], geometryData.vertexData[i + 1]);
                    min[2] = Math.min(min[2], geometryData.vertexData[i + 2]);

                    max[0] = Math.max(max[0], geometryData.vertexData[i]);
                    max[1] = Math.max(max[1], geometryData.vertexData[i + 1]);
                    max[2] = Math.max(max[2], geometryData.vertexData[i + 2]);
                }

                const gltfVertexBufferView = {
                    buffer: 0,
                    byteOffset: this.overallByteLength,
                    byteLength: byteLength,
                    target: WEBGL_CONSTANTS.ARRAY_BUFFER
                };
                this.overallByteLength += byteLength;

                const gltfVertexAccessor = {
                    bufferView: outputJSON.bufferViews.length,
                    byteOffset: 0,
                    componentType: WEBGL_CONSTANTS.FLOAT,
                    count: vertexCount,
                    max: max,
                    min: min,
                    type: "VEC3"
                };

                outputJSON.bufferViews.push(gltfVertexBufferView);
                outputJSON.accessors.push(gltfVertexAccessor);
                gltfMesh.primitives[0].attributes["POSITION"] = outputJSON.accessors.length - 1;



                // ----------- BUFFER FOR NORMALS
                const normalsCount = geometryData.normalData.length / 3;
                if (normalsCount === vertexCount) {
                    byteLength = geometryData.normalData.length * 4;
                    this.dataArrays.push(new Float32Array(geometryData.normalData).buffer);

                    const gltfNormalBufferView = {
                        buffer: 0,
                        byteOffset: this.overallByteLength,
                        byteLength: byteLength,
                        target: WEBGL_CONSTANTS.ARRAY_BUFFER
                    };
                    this.overallByteLength += byteLength;

                    const gltfNormalAccessor = {
                        bufferView: outputJSON.bufferViews.length,
                        byteOffset: 0,
                        componentType: WEBGL_CONSTANTS.FLOAT,
                        count: normalsCount,
                        type: "VEC3"
                    };

                    outputJSON.bufferViews.push(gltfNormalBufferView);
                    outputJSON.accessors.push(gltfNormalAccessor);
                    gltfMesh.primitives[0].attributes["NORMAL"] = outputJSON.accessors.length - 1;
                }



                // ---------- BUFFER FOR UVS
                const uvsCountDefault = geometryData.uvDefaultVertexData.length / 2;
                if (uvsCountDefault === vertexCount) {
                    byteLength = geometryData.uvDefaultVertexData.length * 4;
                    this.dataArrays.push(new Float32Array(geometryData.uvDefaultVertexData).buffer);

                    const gltfUVBufferView = {
                        buffer: 0,
                        byteOffset: this.overallByteLength,
                        byteLength: byteLength,
                        target: WEBGL_CONSTANTS.ARRAY_BUFFER
                    };
                    this.overallByteLength += byteLength;

                    const gltfUVAccessor = {
                        bufferView: outputJSON.bufferViews.length,
                        byteOffset: 0,
                        componentType: WEBGL_CONSTANTS.FLOAT,
                        count: uvsCountDefault,
                        type: "VEC2"
                    };

                    outputJSON.bufferViews.push(gltfUVBufferView);
                    outputJSON.accessors.push(gltfUVAccessor);
                    gltfMesh.primitives[0].attributes["TEXCOORD_0"] = outputJSON.accessors.length - 1;
                }

                const uvsCountBaked = geometryData.uvBakedVertexData.length / 2;
                if (uvsCountBaked === vertexCount) {
                    byteLength = geometryData.uvBakedVertexData.length * 4;
                    this.dataArrays.push(new Float32Array(geometryData.uvBakedVertexData).buffer);

                    const gltfUVBufferView = {
                        buffer: 0,
                        byteOffset: this.overallByteLength,
                        byteLength: byteLength,
                        target: WEBGL_CONSTANTS.ARRAY_BUFFER
                    };
                    this.overallByteLength += byteLength;

                    const gltfUVAccessor = {
                        bufferView: outputJSON.bufferViews.length,
                        byteOffset: 0,
                        componentType: WEBGL_CONSTANTS.FLOAT,
                        count: uvsCountBaked,
                        type: "VEC2"
                    };

                    outputJSON.bufferViews.push(gltfUVBufferView);
                    outputJSON.accessors.push(gltfUVAccessor);
                    gltfMesh.primitives[0].attributes["TEXCOORD_1"] = outputJSON.accessors.length - 1;
                }

                this.cacheAccesors(cachedAccessors, meshData, gltfMesh);
            }
        }


        outputJSON.meshes.push(gltfMesh);

        return outputJSON.meshes.length - 1;
    }

    private cacheAccesors(
        cachedAccessors: AccessorCache,
        meshData: ExportMeshData,
        gltfMesh: Mesh
    ) {
        cachedAccessors = {
            positions: gltfMesh.primitives[0].attributes["POSITION"],
            normals: gltfMesh.primitives[0].attributes["NORMAL"],
            uvsDefault: gltfMesh.primitives[0].attributes["TEXCOORD_0"],
            uvsBaked: gltfMesh.primitives[0].attributes["TEXCOORD_1"],
            indices: gltfMesh.primitives[0].indices
        };

        if (this.compression) {
            cachedAccessors.dracoBufferView = gltfMesh.primitives[0].extensions["KHR_draco_mesh_compression"].bufferView;
        }

        this.geometryIdToGltfGeometryAccessors.set(meshData.geometry.getDatabaseId(), cachedAccessors);
    }

    private getTextureIdx(textureUrl: string, wrapping: number, textureObject: { file: Blob, mimeType: string }, outputJSON: GlTf): number {
        if (!outputJSON.textures) {
            outputJSON.textures = [];
        }

        if (!outputJSON.images) {
            outputJSON.images = [];
        }

        if (!outputJSON.samplers) {
            outputJSON.samplers = [];
        }

        let imageIdx: number = this.imageUrlToImageIdx.get(textureUrl);

        if (imageIdx === undefined) {
            let image: Image;

            if (this.glb) {
                const textureView: BufferView = {
                    buffer: 0,
                    byteOffset: this.overallByteLength,
                    byteLength: textureObject.file.size
                };
                const alignedFile = this.alignTo4ByteBoundary(textureObject.file, 0x20);
                this.overallByteLength += alignedFile.size;

                if (!outputJSON.bufferViews) {
                    outputJSON.bufferViews = [];
                }
                outputJSON.bufferViews.push(textureView);
                this.dataArrays.push(alignedFile);

                image = {
                    mimeType: textureObject.mimeType,
                    bufferView: outputJSON.bufferViews.length - 1
                };

            } else {
                this.images.push(textureObject.file);

                image = {
                    uri: textureUrl + mimeTypeUtil.getExtensionFromMimeType(textureObject.mimeType),
                    mimeType: textureObject.mimeType
                };
            }

            outputJSON.images.push(image);
            imageIdx = outputJSON.images.length - 1;
            this.imageUrlToImageIdx.set(textureUrl, imageIdx);
        }

        let textureIdx = outputJSON.textures.findIndex(gltfTexture => {
            const sameImage = gltfTexture.source === imageIdx;
            const sameWrapMode = outputJSON.samplers[gltfTexture.sampler].wrapS === wrapping;
            return sameImage && sameWrapMode;
        });

        if (textureIdx < 0) {
            let samplerIdx = outputJSON.samplers.findIndex(gltfSampler => gltfSampler.wrapS === wrapping);
            if (samplerIdx < 0) {
                const sampler: Sampler = {
                    wrapS: wrapping,
                    wrapT: wrapping
                };
                outputJSON.samplers.push(sampler);

                samplerIdx = outputJSON.samplers.length - 1;
            }

            const texture: Texture = {
                sampler: samplerIdx,
                source: imageIdx
            };

            outputJSON.textures.push(texture);

            textureIdx = outputJSON.textures.length - 1;
        }

        return textureIdx;
    }

    private getMaterialIdx(materialId: string, materialData: ExportMaterialData[], textureData: Map<string, { file: Blob, mimeType: string }>, outputJSON: GlTf): number {
        const result = this.materialIdToGltfMaterialIdx.get(materialId);

        const editTextureConf = (config: ExportTextureConfig) => {
            const resultConfig = {
                offset: [config.offset[0], -config.offset[1]], // the uvs are flipped when exporting to gltf
                scale: config.scale,
                rotation: config.rotation
            }
            return resultConfig;
        }

        if (result !== undefined) {
            return result;
        } else {
            const materialToSerialize = materialData.find(md => md.id === materialId);
            if (!materialToSerialize) {
                return -1;
            }

            if (!outputJSON.materials) {
                outputJSON.materials = [];
            }

            const gltfMaterial: Material = {
                pbrMetallicRoughness: {
                    baseColorFactor: [
                        Math.pow(materialToSerialize.color[0], 2.2),
                        Math.pow(materialToSerialize.color[1], 2.2),
                        Math.pow(materialToSerialize.color[2], 2.2),
                        materialToSerialize.opacity
                    ]
                },
                name: materialToSerialize.name
            };

            if (materialToSerialize instanceof ExportMaterialDataPBR) {
                if (materialToSerialize.baseColorConfig.textureId) {
                    const textureIndex = this.getTextureIdx(
                        materialToSerialize.baseColorConfig.textureId,
                        materialToSerialize.baseColorConfig.textureWrap,
                        textureData.get(materialToSerialize.baseColorConfig.textureId),
                        outputJSON
                    );
                    const textureTransformExt = { "KHR_texture_transform": editTextureConf(materialToSerialize.baseColorConfig) };
                    gltfMaterial.pbrMetallicRoughness.baseColorTexture = {
                        index: textureIndex,
                        extensions: textureTransformExt,
                        texCoord: materialToSerialize.baseColorConfig.uv === "texCoords1" ? 1 : 0
                    };
                }

                if (materialToSerialize.normalConfig.textureId) {
                    const textureIndex = this.getTextureIdx(
                        materialToSerialize.normalConfig.textureId,
                        materialToSerialize.normalConfig.textureWrap,
                        textureData.get(materialToSerialize.normalConfig.textureId),
                        outputJSON
                    );
                    const textureTransformExt = { "KHR_texture_transform": editTextureConf(materialToSerialize.normalConfig) };
                    gltfMaterial.normalTexture = {
                        index: textureIndex,
                        scale: materialToSerialize.normalFactor,
                        extensions: textureTransformExt,
                        texCoord: materialToSerialize.normalConfig.uv === "texCoords1" ? 1 : 0
                    };
                }

                if (materialToSerialize.metallicConfig.textureId) {
                    const textureIndex = this.getTextureIdx(
                        materialToSerialize.metallicConfig.textureId,
                        materialToSerialize.metallicConfig.textureWrap,
                        textureData.get(materialToSerialize.metallicConfig.textureId),
                        outputJSON
                    );
                    const textureTransformExt = { "KHR_texture_transform": editTextureConf(materialToSerialize.metallicConfig) };
                    gltfMaterial.pbrMetallicRoughness.metallicRoughnessTexture = {
                        index: textureIndex,
                        extensions: textureTransformExt,
                        texCoord: materialToSerialize.metallicConfig.uv === "texCoords1" ? 1 : 0
                    };
                }
                gltfMaterial.pbrMetallicRoughness.metallicFactor = materialToSerialize.metallicFactor;

                if (materialToSerialize.roughnessConfig.textureId) {
                    const textureIndex = this.getTextureIdx(
                        materialToSerialize.roughnessConfig.textureId,
                        materialToSerialize.roughnessConfig.textureWrap,
                        textureData.get(materialToSerialize.roughnessConfig.textureId),
                        outputJSON
                    );
                    const textureTransformExt = { "KHR_texture_transform": editTextureConf(materialToSerialize.roughnessConfig) };
                    gltfMaterial.pbrMetallicRoughness.metallicRoughnessTexture = {
                        index: textureIndex,
                        extensions: textureTransformExt,
                        texCoord: materialToSerialize.roughnessConfig.uv === "texCoords1" ? 1 : 0
                    };
                }
                gltfMaterial.pbrMetallicRoughness.roughnessFactor = materialToSerialize.roughnessFactor;

                if (materialToSerialize.emissiveConfig.textureId) {
                    const textureIndex = this.getTextureIdx(
                        materialToSerialize.emissiveConfig.textureId,
                        materialToSerialize.emissiveConfig.textureWrap,
                        textureData.get(materialToSerialize.emissiveConfig.textureId),
                        outputJSON
                    );
                    const textureTransformExt = { "KHR_texture_transform": editTextureConf(materialToSerialize.emissiveConfig) };
                    gltfMaterial.emissiveTexture = {
                        index: textureIndex,
                        extensions: textureTransformExt,
                        texCoord: materialToSerialize.occlusionConfig.uv === "texCoords1" ? 1 : 0
                    };
                }
                gltfMaterial.emissiveFactor = materialToSerialize.emissiveFactor;

                if (materialToSerialize.occlusionConfig.textureId) {
                    const textureIndex = this.getTextureIdx(
                        materialToSerialize.occlusionConfig.textureId,
                        materialToSerialize.occlusionConfig.textureWrap,
                        textureData.get(materialToSerialize.occlusionConfig.textureId),
                        outputJSON
                    );
                    const textureTransformExt = { "KHR_texture_transform": editTextureConf(materialToSerialize.occlusionConfig) };
                    gltfMaterial.occlusionTexture = {
                        index: textureIndex,
                        strength: materialToSerialize.occlusionFactor,
                        extensions: textureTransformExt,
                        texCoord: materialToSerialize.occlusionConfig.uv === "texCoords1" ? 1 : 0
                    };
                }

                if (this.lightMap) {
                    if (materialToSerialize.lightmapConfig.textureId) {
                        const textureIndex = this.getTextureIdx(
                            materialToSerialize.lightmapConfig.textureId,
                            materialToSerialize.lightmapConfig.textureWrap,
                            textureData.get(materialToSerialize.lightmapConfig.textureId),
                            outputJSON
                        );
                        gltfMaterial.lightmapTexture = {
                            index: textureIndex,
                            texCoord: materialToSerialize.lightmapConfig.uv === "texCoords1" ? 1 : 0
                        };
                    }
                }

                gltfMaterial.alphaMode = materialToSerialize.alphaMode;
                if (gltfMaterial.alphaMode === "MASK") {
                    gltfMaterial.alphaCutoff = materialToSerialize.alphaCutoff;
                }
                gltfMaterial.doubleSided = materialToSerialize.doubleSided;
            }

            outputJSON.materials.push(gltfMaterial);
            this.materialIdToGltfMaterialIdx.set(materialId, outputJSON.materials.length - 1);

            return outputJSON.materials.length - 1;
        }
    }

    private processObjectData(objectData: ExportObjectData, materialData: ExportMaterialData[], textureData: Map<string, { file: Blob, mimeType: string }>, outputJSON: GlTf): number {
        let idx = -1;
        if (objectData instanceof ExportCameraData) {
            idx = this.processCameraData(objectData, outputJSON);
        } else if (objectData instanceof ExportLightData) {
            idx = this.processLightData(objectData, outputJSON);
        } else {
            idx = this.processMeshData(objectData, materialData, textureData, outputJSON);
        }

        return idx;
    }

    private processCameraData(camera: ExportCameraData, outputJSON: GlTf): number {
        if (!outputJSON.nodes) {
            outputJSON.nodes = [];
        }

        const gltfNode: Node = {};

        const toGltfCameraRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
        toGltfCameraRotation.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));

        const translation = camera.position.clone();
        const quaternion = camera.quaternion.clone().multiply(toGltfCameraRotation);
        const scale = camera.scale.clone();

        if (camera.parent === null) {
            translation.multiplyScalar(this.unitMeters);
        } else {
            // compensate for the object scaling done on root parent
            scale.multiplyScalar(1 / this.unitMeters);
        }

        gltfNode.translation = translation.toArray();
        gltfNode.scale = scale.toArray();
        gltfNode.rotation = quaternion.toArray();

        if (camera.name) {
            gltfNode.name = camera.name;
        }

        const gltfCameraId = this.processCamera(camera, outputJSON);
        if (gltfCameraId > -1) {
            gltfNode.camera = gltfCameraId;
        }

        outputJSON.nodes.push(gltfNode);
        return outputJSON.nodes.length - 1;
    }

    private processLightData(light: ExportLightData, outputJSON: GlTf): number {
        if (!outputJSON.nodes) {
            outputJSON.nodes = [];
        }

        const gltfNode: Node = {};

        const toGltfLightRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
        toGltfLightRotation.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));

        const translation = light.position.clone();
        const quaternion = light.quaternion.clone().multiply(toGltfLightRotation);

        if (light.parent === null) {
            translation.multiplyScalar(this.unitMeters);
        }

        gltfNode.translation = translation.toArray();
        gltfNode.scale = light.scale.toArray();
        gltfNode.rotation = quaternion.toArray();

        if (light.name) {
            gltfNode.name = light.name;
        }

        const index = this.processLight(light, outputJSON);

        if (index >= 0) {
            const extensionName = (light.hemisphere || light.rectangle || light.tube) ? "VCTR_lights" : "KHR_lights_punctual";
            gltfNode.extensions = {};
            gltfNode.extensions[extensionName] = {
                "light": index
            };

            outputJSON.nodes.push(gltfNode);
            return outputJSON.nodes.length - 1;
        }
        return -1;
    }

    private processMeshData(objectData: ExportObjectData, materialData: ExportMaterialData[], textureData: Map<string, { file: Blob, mimeType: string }>, outputJSON: GlTf): number {
        if (!outputJSON.nodes) {
            outputJSON.nodes = [];
        }

        const gltfNode: Node = {};

        const translation = objectData.position.clone();
        const scale = objectData.scale.clone();

        if (objectData.parent === null) {
            translation.multiplyScalar(this.unitMeters);
            scale.multiplyScalar(this.unitMeters);
        }

        gltfNode.translation = translation.toArray();
        gltfNode.scale = scale.toArray();
        gltfNode.rotation = objectData.quaternion.toArray();

        if (objectData.name) {
            gltfNode.name = objectData.name;
        }

        if ((objectData instanceof ExportMeshData) && objectData.hasGeometry()) {
            const gltfMeshId = this.processMesh(objectData, materialData, textureData, outputJSON);
            if (gltfMeshId > -1) {
                gltfNode.mesh = gltfMeshId;
            }
        }

        outputJSON.nodes.push(gltfNode);
        return outputJSON.nodes.length - 1;
    }

    private getOutputJSON(objectData: ExportObjectData[], materialData: ExportMaterialData[], textureData: Map<string, { file: Blob, mimeType: string }>): GlTf {
        const outputJSON: GlTf = {
            asset: {
                version: "2.0",
                generator: "VECTARY"
            }
        };


        // Process objects
        const processObjectDataRecursion = (od: ExportObjectData) => {
            let idx = this.processObjectData(od, materialData, textureData, outputJSON);

            if (idx >= 0) {
                if (od.hasChildren()) {
                    let childrenIndices = od.children.map(chIdx => processObjectDataRecursion(objectData[chIdx]));
                    outputJSON.nodes[idx].children = childrenIndices.filter(chIdx => chIdx !== -1);
                }
            }

            return idx;
        };

        const rootObjectData = objectData.filter(od => od.parent === null);

        let rootNodes = rootObjectData.map((rod: ExportObjectData) => {
            rod.switchUpVectorToY();
            return processObjectDataRecursion(rod);
        });
        rootNodes = rootNodes.filter(idx => idx !== -1);


        // Create scene
        outputJSON.scene = 0;

        const gltfScene: Scene = {
            nodes: rootNodes,
            name: this.projectName
        };

        outputJSON.scenes = [gltfScene];


        // Define extensions
        outputJSON.extensionsUsed = ["KHR_texture_transform"];
        outputJSON.extensionsRequired = [];

        if (outputJSON.extensions && outputJSON.extensions["KHR_lights_punctual"]) {
            // only register light extension if there were lights
            outputJSON.extensionsUsed.push("KHR_lights_punctual");
            outputJSON.extensionsRequired.push("KHR_lights_punctual");
        }

        if (outputJSON.extensions && outputJSON.extensions["VCTR_lights"]) {
            // only register light extension if there were lights
            outputJSON.extensionsUsed.push("VCTR_lights");
            outputJSON.extensionsRequired.push("VCTR_lights");
        }

        if (this.compression) {
            outputJSON.extensionsUsed.push("KHR_draco_mesh_compression");
            outputJSON.extensionsRequired.push("KHR_draco_mesh_compression");
        }

        if (outputJSON.extensionsRequired.length === 0) {
            // "entity can't be empty" for some reason..
            outputJSON.extensionsRequired = undefined;
        }

        return outputJSON;
    }

    private alignTo4ByteBoundary(chunk: Blob, fillWith: any): Blob {
        const numOfElementsToFill = (4 - chunk.size % 4) % 4;

        if (numOfElementsToFill === 0) {
            return chunk;
        }

        const fillingArray = new Uint8Array(numOfElementsToFill);
        for (let i = 0; i < fillingArray.length; i++) {
            fillingArray[i] = fillWith;
        }

        return new Blob([chunk, fillingArray.buffer]);
    };

    private getMimeType(): string {
        return this.glb ? "model/gltf-binary" : "model/gltf+json";
    }

    private getExtension(): string {
        return this.glb ? "glb" : "gltf";
    }
};
