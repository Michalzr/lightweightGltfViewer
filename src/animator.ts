import { LoadedGltf } from "./models/loadedGltf";
import * as Mat4Math from "./utils/math/martix4";
import * as Vec3Math from "./utils/math/vector3";
import * as QuaternionMath from "./utils/math/quaternion";

export class Animator {
  private loadedGltf: LoadedGltf;
  private startTime = Date.now() / 1000;
  private animationEnd: number = Infinity;

  constructor(loadedGltf: LoadedGltf) {
    this.loadedGltf = loadedGltf;

    this.loadedGltf.animations.forEach((animation) => {
      animation.channels.forEach((channel) => {
        const sampler = animation.samplers[channel.sampler];
        const endOfAnimation = sampler.inputData[sampler.inputData.length - 1];

        this.animationEnd = Math.min(endOfAnimation, this.animationEnd);
      });
    });
  }

  // TODO: move the horrible data reading to a gltfPreprocess step
  // TODO: implement different kinds of interpolation

  animate(): void {
    let time = Date.now() / 1000 - this.startTime;
    time = time % this.animationEnd; // this puts the animation in loop

    this.loadedGltf.animations.forEach((animation) => {
      animation.channels.forEach((channel) => {
        const sampler = animation.samplers[channel.sampler];

        const animationIndex = sampler.inputData.findIndex((v) => v > time);

        if (animationIndex > 0) {
          const parameter =
            (time - sampler.inputData[animationIndex - 1]) / (sampler.inputData[animationIndex] - sampler.inputData[animationIndex - 1]);
          if (channel.target.path === "translation") {
            const tA: Vec3Math.Vec3 = [
              sampler.outputData[(animationIndex - 1) * 3],
              sampler.outputData[(animationIndex - 1) * 3 + 1],
              sampler.outputData[(animationIndex - 1) * 3 + 2],
            ];
            const tB: Vec3Math.Vec3 = [
              sampler.outputData[animationIndex * 3],
              sampler.outputData[animationIndex * 3 + 1],
              sampler.outputData[animationIndex * 3 + 2],
            ];

            this.loadedGltf.nodes[channel.target.node].translation = Vec3Math.lerp(tA, tB, parameter);
          } else if (channel.target.path === "rotation") {
            const qA: QuaternionMath.Quaternion = [
              sampler.outputData[(animationIndex - 1) * 4],
              sampler.outputData[(animationIndex - 1) * 4 + 1],
              sampler.outputData[(animationIndex - 1) * 4 + 2],
              sampler.outputData[(animationIndex - 1) * 4 + 3],
            ];
            const qB: QuaternionMath.Quaternion = [
              sampler.outputData[animationIndex * 4],
              sampler.outputData[animationIndex * 4 + 1],
              sampler.outputData[animationIndex * 4 + 2],
              sampler.outputData[animationIndex * 4 + 3],
            ];

            this.loadedGltf.nodes[channel.target.node].rotation = QuaternionMath.slerp(qA, qB, parameter);
          } else if (channel.target.path === "scale") {
            const sA: Vec3Math.Vec3 = [
              sampler.outputData[(animationIndex - 1) * 3],
              sampler.outputData[(animationIndex - 1) * 3 + 1],
              sampler.outputData[(animationIndex - 1) * 3 + 2],
            ];
            const sB: Vec3Math.Vec3 = [
              sampler.outputData[animationIndex * 3],
              sampler.outputData[animationIndex * 3 + 1],
              sampler.outputData[animationIndex * 3 + 2],
            ];

            this.loadedGltf.nodes[channel.target.node].scale = Vec3Math.lerp(sA, sB, parameter);
          }
        }
      });
    });

    this.updateMatrices();
  }

  private updateMatrices(): void {
    this.loadedGltf.nodes.forEach((node) => {
      if (node.translation || node.rotation || node.scale) {
        const translation: Vec3Math.Vec3 = (node.translation as Vec3Math.Vec3) || [0, 0, 0];
        const rotation: QuaternionMath.Quaternion = (node.rotation as QuaternionMath.Quaternion) || QuaternionMath.create();
        const scale: Vec3Math.Vec3 = (node.scale as Vec3Math.Vec3) || [1, 1, 1];

        node.matrix = Mat4Math.fromTranslationRotationScale(translation, rotation, scale);
      }
    });
  }
}
