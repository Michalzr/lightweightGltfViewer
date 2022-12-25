import * as Vec3Math from "./utils/math/vector3";
import * as Vec2Math from "./utils/math/vector2";
import * as Mat4Math from "./utils/math/martix4";
import { Signal } from "./utils/signal";

enum OrbitControlsState {
  NONE,
  PAN,
  ROTATE,
}

export class OrbitControls {
  readonly sigChange = new Signal();

  private readonly canvas: HTMLElement;

  private state: OrbitControlsState;

  private rotateStart: Vec2Math.Vec2 = [0, 0];
  private panStart: Vec2Math.Vec2 = [0, 0];
  private pinchStart: number = 0;

  private radiusStart: number = 0;
  private targetStart: Vec3Math.Vec3 = [0, 0, 0];
  private phiStart: number = 0;
  private thetaStart: number = 0;

  private target: Vec3Math.Vec3 = [0, 0, 0];
  private radius: number = 2;
  private phi: number = Math.PI / 4;
  private theta: number = Math.PI / 4;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;

    // don't show context menu on right click
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), false);

    canvas.addEventListener("mousedown", this.onMouseDown, false);
    canvas.addEventListener("wheel", this.onMouseWheel, false);
    canvas.addEventListener("touchstart", this.onTouchStart, false);
  }

  resetCamera(): void {
    this.target = [0, 0, 0];
    this.radius = 2;
    this.phi = Math.PI / 4;
    this.theta = Math.PI / 4;
  }

  getViewMatrix(): Mat4Math.Mat4 {
    return Mat4Math.invert(this.getCameraMatrix());
  }

  private getCameraMatrix(): Mat4Math.Mat4 {
    const direction: Vec3Math.Vec3 = [
      this.radius * Math.sin(this.phi) * Math.cos(this.theta),
      this.radius * Math.cos(this.phi),
      this.radius * Math.sin(this.phi) * Math.sin(this.theta),
    ];

    const position = Vec3Math.add(direction, this.target);

    const cameraMatrix = Mat4Math.lookAt(position, this.target, [0, 1, 0]); // set camera orientation
    Mat4Math.setTranslation(cameraMatrix, position); // set camera position

    return cameraMatrix;
  }

  // ---------------- mouse event handling
  private onMouseDown = (event: MouseEvent) => {
    // Prevent the browser from scrolling.
    event.preventDefault();

    // Manually set the focus since calling preventDefault above
    // prevents the browser from setting it automatically.
    this.canvas.focus ? this.canvas.focus() : window.focus();

    switch (event.button) {
      case 0: // left
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.handleMouseDownPan(event.clientX, event.clientY);
          this.state = OrbitControlsState.PAN;
        } else {
          this.handleMouseDownRotate(event.clientX, event.clientY);
          this.state = OrbitControlsState.ROTATE;
        }
        break;

      case 2: // right
        this.handleMouseDownPan(event.clientX, event.clientY);
        this.state = OrbitControlsState.PAN;
        break;
    }

    if (this.state !== OrbitControlsState.NONE) {
      document.addEventListener("mousemove", this.onMouseMove, false);
      document.addEventListener("mouseup", this.onMouseUp, false);
    }
  };

  private onMouseMove = (event: MouseEvent) => {
    event.preventDefault();

    switch (this.state) {
      case OrbitControlsState.ROTATE:
        this.handleMouseMoveRotate(event.clientX, event.clientY);
        break;

      case OrbitControlsState.PAN:
        this.handleMouseMovePan(event.clientX, event.clientY);
        break;
    }
  };

  private onMouseUp = (event: MouseEvent) => {
    this.handleMouseUp();

    document.removeEventListener("mousemove", this.onMouseMove, false);
    document.removeEventListener("mouseup", this.onMouseUp, false);

    this.state = OrbitControlsState.NONE;
  };

  private onMouseWheel = (event: WheelEvent) => {
    // TODO: is this condition necessary?
    if (this.state !== OrbitControlsState.NONE && this.state !== OrbitControlsState.ROTATE) return;

    event.preventDefault();
    event.stopPropagation();

    this.handleMouseWheel(event);
  };

  // ---------------- touch event handling
  private onTouchStart = (event: TouchEvent) => {
    this.canvas.focus ? this.canvas.focus() : window.focus();

    switch (event.touches.length) {
      case 1:
        this.handleMouseDownRotate(event.touches[0].clientX, event.touches[0].clientY);
        this.state = OrbitControlsState.ROTATE;
        break;

      case 2:
        this.handlePinchStart(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
        this.handleMouseDownPan(
          (event.touches[0].clientX + event.touches[1].clientX) * 0.5,
          (event.touches[0].clientY + event.touches[1].clientY) * 0.5
        );
        this.state = OrbitControlsState.PAN;
        break;
    }

    if (this.state !== OrbitControlsState.NONE) {
      document.addEventListener("touchmove", this.onTouchMove, false);
      document.addEventListener("touchend", this.onTouchEnd, false);
    }
  };

  private onTouchMove = (event: TouchEvent) => {
    switch (this.state) {
      case OrbitControlsState.ROTATE:
        this.handleMouseMoveRotate(event.touches[0].clientX, event.touches[0].clientY);
        break;

      case OrbitControlsState.PAN:
        this.handlePinchMove(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
        this.handleMouseMovePan(
          (event.touches[0].clientX + event.touches[1].clientX) * 0.5,
          (event.touches[0].clientY + event.touches[1].clientY) * 0.5
        );
        break;
    }
  };

  private onTouchEnd = (event: TouchEvent) => {
    this.handleMouseUp();

    document.removeEventListener("touchmove", this.onTouchMove, false);
    document.removeEventListener("touchend", this.onTouchEnd, false);

    this.state = OrbitControlsState.NONE;
  };

  // ---------------- mouse/touch down
  private handleMouseDownRotate(x: number, y: number): void {
    this.rotateStart[0] = x;
    this.rotateStart[1] = y;

    this.thetaStart = this.theta;
    this.phiStart = this.phi;
  }

  private handleMouseDownPan(x: number, y: number): void {
    this.panStart[0] = x;
    this.panStart[1] = y;

    this.targetStart = Vec3Math.clone(this.target);
  }

  private handlePinchStart(x: number, y: number): void {
    this.pinchStart = Vec2Math.length([x, y]);
    this.radiusStart = this.radius;
  }

  // ---------------- mouse/touch move
  private handleMouseMoveRotate(x: number, y: number): void {
    const rotateEnd: Vec2Math.Vec2 = [x, y];
    const rotateDelta = Vec2Math.sub(rotateEnd, this.rotateStart);

    this.theta = this.thetaStart + (2 * Math.PI * rotateDelta[0]) / this.canvas.clientHeight; // yes, height

    this.phi = this.phiStart - (2 * Math.PI * rotateDelta[1]) / this.canvas.clientHeight;
    this.phi = Math.max(0, Math.min(Math.PI, this.phi));

    this.sigChange.emit();
  }

  private handleMouseMovePan(x: number, y: number): void {
    const panEnd: Vec2Math.Vec2 = [x, y];
    const panDelta = Vec2Math.sub(panEnd, this.panStart);
    Vec2Math.multiplyScalar(panDelta, this.radius / this.canvas.clientHeight);

    const panOffset: Vec3Math.Vec3 = [-panDelta[0], panDelta[1], 0];
    const cameraRotationMatrix = Mat4Math.setTranslation(this.getCameraMatrix(), [0, 0, 0]);
    Vec3Math.applyMatrix(panOffset, cameraRotationMatrix);

    this.target = Vec3Math.add(panOffset, this.targetStart);

    this.sigChange.emit();
  }

  private handlePinchMove(x: number, y: number): void {
    const radiusDelta = this.pinchStart / Vec2Math.length([x, y]);
    this.radius = this.radiusStart * radiusDelta;

    this.sigChange.emit();
  }

  // ---------------- mouse/touch up
  private handleMouseUp(): void {
    // nothing..
  }

  // ---------------- mouse wheel
  private handleMouseWheel(event: WheelEvent): void {
    if (event.deltaY < 0) {
      this.radius *= 0.95;
    } else {
      this.radius *= 1.05263158;
    }

    this.sigChange.emit();
  }
}
