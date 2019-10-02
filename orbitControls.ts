import * as Vec3Math from "./utils/mathUtils/vector3.js";
import * as Vec2Math from "./utils/mathUtils/vector2.js";
import * as Mat4Math from "./utils/mathUtils/martix4.js";
import { Signal } from "./signal.js";

enum OrbitControlsState {
    NONE,
    PAN,
    ROTATE
}

export class OrbitControls {
    readonly sigChange = new Signal();

    private readonly canvas: HTMLElement;

    private state: OrbitControlsState;

    private rotateStart: Vec2Math.Vec2 = [0, 0];
    private panStart: Vec2Math.Vec2 = [0, 0];

    private targetStart: Vec3Math.Vec3 = [0, 0, 0];
    private phiStart: number = 0;
    private thetaStart: number = 0;

    private target: Vec3Math.Vec3 = [0, 0, 0];
    private radius: number = 6;
    private phi: number = Math.PI / 4;
    private theta: number = Math.PI / 4;

    constructor(canvas: HTMLElement) {
        this.canvas = canvas;

        // don't show context menu on right click
        canvas.addEventListener('contextmenu', e => e.preventDefault(), false);

        canvas.addEventListener('mousedown', this.onMouseDown, false);
        canvas.addEventListener('wheel', this.onMouseWheel, false);

        // TODO: touch devices
        // canvas.addEventListener( 'touchstart', onTouchStart, false );
        // canvas.addEventListener( 'touchend', onTouchEnd, false );
        // canvas.addEventListener( 'touchmove', onTouchMove, false );
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

    private onMouseDown = (event: MouseEvent) => {
        // Prevent the browser from scrolling.
        event.preventDefault();

        // Manually set the focus since calling preventDefault above
        // prevents the browser from setting it automatically.
        this.canvas.focus ? this.canvas.focus() : window.focus();


        switch (event.button) {
            case 0: // left
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                    this.handleMouseDownPan(event);
                    this.state = OrbitControlsState.PAN;

                } else {
                    this.handleMouseDownRotate(event);
                    this.state = OrbitControlsState.ROTATE;
                }
                break;

            case 2: // right
                this.handleMouseDownPan(event);
                this.state = OrbitControlsState.PAN;
                break;

        }

        if (this.state !== OrbitControlsState.NONE) {
            document.addEventListener('mousemove', this.onMouseMove, false);
            document.addEventListener('mouseup', this.onMouseUp, false);
        }
    }

    private onMouseMove = (event: MouseEvent) => {
        event.preventDefault();

        switch (this.state) {
            case OrbitControlsState.ROTATE:
                this.handleMouseMoveRotate(event);
                break;

            case OrbitControlsState.PAN:
                this.handleMouseMovePan(event);
                break;
        }
    }

    private onMouseUp = (event: MouseEvent) => {
        this.handleMouseUp(event);

        document.removeEventListener('mousemove', this.onMouseMove, false);
        document.removeEventListener('mouseup', this.onMouseUp, false);

        this.state = OrbitControlsState.NONE;
    }



    private onMouseWheel = (event: MouseWheelEvent) => {
        // TODO: is this condition necessary?
        if ((this.state !== OrbitControlsState.NONE) && (this.state !== OrbitControlsState.ROTATE)) return;

        event.preventDefault();
        event.stopPropagation();

        this.handleMouseWheel(event);
    }



    // ---------------- mouse down
    private handleMouseDownRotate(event: MouseEvent): void {
        this.rotateStart[0] = event.clientX;
        this.rotateStart[1] = event.clientY;

        this.thetaStart = this.theta;
        this.phiStart = this.phi;
    }

    private handleMouseDownPan(event: MouseEvent): void {
        this.panStart[0] = event.clientX;
        this.panStart[1] = event.clientY;

        this.targetStart = Vec3Math.clone(this.target);
    }


    // ---------------- mouse move
    private handleMouseMoveRotate(event: MouseEvent): void {
        const rotateEnd: Vec2Math.Vec2 = [event.clientX, event.clientY];
        const rotateDelta = Vec2Math.sub(rotateEnd, this.rotateStart);

        this.theta = this.thetaStart + 2 * Math.PI * rotateDelta[0] / this.canvas.clientHeight; // yes, height

        this.phi = this.phiStart - 2 * Math.PI * rotateDelta[1] / this.canvas.clientHeight;
        this.phi = Math.max(0, Math.min(Math.PI, this.phi));

        this.sigChange.emit();
    }

    private handleMouseMovePan(event: MouseEvent): void {
        const panEnd: Vec2Math.Vec2 = [event.clientX, event.clientY];
        const panDelta = Vec2Math.sub(panEnd, this.panStart);
        Vec2Math.multiplyScalar(panDelta, this.radius / this.canvas.clientHeight);

        const panOffset: Vec3Math.Vec3 = [- panDelta[0], panDelta[1], 0];
        const cameraRotationMatrix = Mat4Math.setTranslation(this.getCameraMatrix(), [0, 0, 0]);
        Vec3Math.applyMatrix(panOffset, cameraRotationMatrix);

        this.target = Vec3Math.add(panOffset, this.targetStart);

        this.sigChange.emit();
    }


    // ---------------- mouse up
    private handleMouseUp(event: MouseEvent): void {
        // nothing..
    }


    // ---------------- mouse wheel
    private handleMouseWheel(event: MouseWheelEvent): void {
        if (event.deltaY < 0) {
            this.radius *= 0.95;

        } else {
            this.radius *= 1.05263158
        }

        this.sigChange.emit();
    }
}