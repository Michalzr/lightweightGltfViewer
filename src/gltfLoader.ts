import * as GlTf from "./models/gltf";
import { NamedBlob, preprocessUri } from "./utils/fileUtils";
import { LoadedGltf, Accessor } from "./models/loadedGltf";
import * as GltfPostprocess from "./gltfPostProcess";

export class GltfLoader {
  private static readonly gltfExtension = ".gltf";
  private static readonly glbExtension = ".glb";

  textureSourceIdxToId: Map<number, string> = new Map();

  async load(files: NamedBlob[]): Promise<LoadedGltf> {
    const gltfFile = files.find((f) => f.name.endsWith(GltfLoader.gltfExtension) || f.name.endsWith(GltfLoader.glbExtension));

    if (!gltfFile) {
      window.alert('No ".gltf" or ".glb" file found.');
      return;
    }

    const loadedGltf = gltfFile.name.endsWith(GltfLoader.gltfExtension)
      ? await this.parseNonBinary(gltfFile, files)
      : await this.parseBinary(gltfFile, files);

    GltfPostprocess.fillGltfDefaultValues(loadedGltf);
    GltfPostprocess.fitToView(loadedGltf);

    return loadedGltf;
  }

  private async parseBinary(glb: NamedBlob, files: NamedBlob[]): Promise<LoadedGltf> {
    this.textureSourceIdxToId = new Map();

    const glbAsBuffer = await new Response(glb.blob).arrayBuffer();
    const glbDataView = new DataView(glbAsBuffer);

    let offset = 0;
    const glbMagicIdentificator = glbDataView.getUint32(offset, true);
    if (glbMagicIdentificator !== 0x46546c67) {
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
    if (jsonChunkType !== 0x4e4f534a) {
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
      const binDataFound = chunkType === 0x004e4942;
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
    }

    const data = await this.loadImagesAndBuffers(gltfJson, files);

    return this.createImportData(gltfJson, data.buffers, data.images);
  }

  private async loadImagesAndBuffers(
    gltfJson: GlTf.GlTf,
    files: NamedBlob[],
    glbBuffer?: ArrayBuffer
  ): Promise<{ images: HTMLImageElement[]; buffers: ArrayBuffer[] }> {
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
        const fileCandidate = files.find((file) => file.name === processedFileUri);

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
            const imageFile = files.find((file) => file.name === processedFileUri);

            if (!imageFile) {
              return Promise.reject("Image file " + i.uri + " not found.");
            }

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
          image.addEventListener("load", () => {
            resolve(image);
          });
          image.src = url;
        });
      });

      images = await Promise.all(imageFilesPromises);
    }

    return {
      images,
      buffers,
    };
  }

  private createImportData(gltfJson: GlTf.GlTf, buffers: ArrayBuffer[], images: HTMLImageElement[]): LoadedGltf {
    // move "byteStride" from BufferView to Accessor
    gltfJson.accessors.forEach((gltfAccessor) => {
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
      dataViews: this.createDataViews(gltfJson, buffers),
      skins: gltfJson.skins,
      animations: gltfJson.animations,
    };
  }

  private createDataViews(gltfJson: GlTf.GlTf, buffers: ArrayBuffer[]): DataView[] {
    return gltfJson.bufferViews.map((gltfBufferView) => {
      const buffer = buffers[gltfBufferView.buffer];
      return new DataView(buffer, gltfBufferView.byteOffset, gltfBufferView.byteLength);
    });
  }
}
