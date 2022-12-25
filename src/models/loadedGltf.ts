import * as GlTf from "./gltf";
import * as Mat4Math from "../utils/math/martix4";

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
  skins?: Skin[];
  animations?: Animation[];
}

export interface Accessor extends GlTf.Accessor {
  byteStride?: number;
}

export interface Skin extends GlTf.Skin {
  inverseBindMatricesData?: Mat4Math.Mat4[];
}

export interface AnimationSampler extends GlTf.AnimationSampler {
  inputData?: Float32Array;
  outputData?: Float32Array;
}

export interface Animation extends GlTf.Animation {
  samplers: AnimationSampler[];
}
