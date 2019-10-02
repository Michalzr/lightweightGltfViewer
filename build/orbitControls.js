import * as Vec3Math from "./utils/mathUtils/vector3.js";
import * as Vec2Math from "./utils/mathUtils/vector2.js";
import * as Mat4Math from "./utils/mathUtils/martix4.js";
import { Signal } from "./signal.js";
var OrbitControlsState;
(function (OrbitControlsState) {
    OrbitControlsState[OrbitControlsState["NONE"] = 0] = "NONE";
    OrbitControlsState[OrbitControlsState["PAN"] = 1] = "PAN";
    OrbitControlsState[OrbitControlsState["ROTATE"] = 2] = "ROTATE";
})(OrbitControlsState || (OrbitControlsState = {}));
export class OrbitControls {
    constructor(canvas) {
        this.sigChange = new Signal();
        this.rotateStart = [0, 0];
        this.panStart = [0, 0];
        this.targetStart = [0, 0, 0];
        this.phiStart = 0;
        this.thetaStart = 0;
        this.target = [0, 0, 0];
        this.radius = 6;
        this.phi = Math.PI / 4;
        this.theta = Math.PI / 4;
        this.onMouseDown = (event) => {
            event.preventDefault();
            this.canvas.focus ? this.canvas.focus() : window.focus();
            switch (event.button) {
                case 0:
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                        this.handleMouseDownPan(event);
                        this.state = OrbitControlsState.PAN;
                    }
                    else {
                        this.handleMouseDownRotate(event);
                        this.state = OrbitControlsState.ROTATE;
                    }
                    break;
                case 2:
                    this.handleMouseDownPan(event);
                    this.state = OrbitControlsState.PAN;
                    break;
            }
            if (this.state !== OrbitControlsState.NONE) {
                document.addEventListener('mousemove', this.onMouseMove, false);
                document.addEventListener('mouseup', this.onMouseUp, false);
            }
        };
        this.onMouseMove = (event) => {
            event.preventDefault();
            switch (this.state) {
                case OrbitControlsState.ROTATE:
                    this.handleMouseMoveRotate(event);
                    break;
                case OrbitControlsState.PAN:
                    this.handleMouseMovePan(event);
                    break;
            }
        };
        this.onMouseUp = (event) => {
            this.handleMouseUp(event);
            document.removeEventListener('mousemove', this.onMouseMove, false);
            document.removeEventListener('mouseup', this.onMouseUp, false);
            this.state = OrbitControlsState.NONE;
        };
        this.onMouseWheel = (event) => {
            if ((this.state !== OrbitControlsState.NONE) && (this.state !== OrbitControlsState.ROTATE))
                return;
            event.preventDefault();
            event.stopPropagation();
            this.handleMouseWheel(event);
        };
        this.canvas = canvas;
        canvas.addEventListener('contextmenu', e => e.preventDefault(), false);
        canvas.addEventListener('mousedown', this.onMouseDown, false);
        canvas.addEventListener('wheel', this.onMouseWheel, false);
    }
    getViewMatrix() {
        return Mat4Math.invert(this.getCameraMatrix());
    }
    getCameraMatrix() {
        const direction = [
            this.radius * Math.sin(this.phi) * Math.cos(this.theta),
            this.radius * Math.cos(this.phi),
            this.radius * Math.sin(this.phi) * Math.sin(this.theta),
        ];
        const position = Vec3Math.add(direction, this.target);
        const cameraMatrix = Mat4Math.lookAt(position, this.target, [0, 1, 0]);
        Mat4Math.setTranslation(cameraMatrix, position);
        return cameraMatrix;
    }
    handleMouseDownRotate(event) {
        this.rotateStart[0] = event.clientX;
        this.rotateStart[1] = event.clientY;
        this.thetaStart = this.theta;
        this.phiStart = this.phi;
    }
    handleMouseDownPan(event) {
        this.panStart[0] = event.clientX;
        this.panStart[1] = event.clientY;
        this.targetStart = Vec3Math.clone(this.target);
    }
    handleMouseMoveRotate(event) {
        const rotateEnd = [event.clientX, event.clientY];
        const rotateDelta = Vec2Math.sub(rotateEnd, this.rotateStart);
        this.theta = this.thetaStart + 2 * Math.PI * rotateDelta[0] / this.canvas.clientHeight;
        this.phi = this.phiStart - 2 * Math.PI * rotateDelta[1] / this.canvas.clientHeight;
        this.phi = Math.max(0, Math.min(Math.PI, this.phi));
        this.sigChange.emit();
    }
    handleMouseMovePan(event) {
        const panEnd = [event.clientX, event.clientY];
        const panDelta = Vec2Math.sub(panEnd, this.panStart);
        Vec2Math.multiplyScalar(panDelta, this.radius / this.canvas.clientHeight);
        const panOffset = [-panDelta[0], panDelta[1], 0];
        const cameraRotationMatrix = Mat4Math.setTranslation(this.getCameraMatrix(), [0, 0, 0]);
        Vec3Math.applyMatrix(panOffset, cameraRotationMatrix);
        this.target = Vec3Math.add(panOffset, this.targetStart);
        this.sigChange.emit();
    }
    handleMouseUp(event) {
    }
    handleMouseWheel(event) {
        if (event.deltaY < 0) {
            this.radius *= 0.95;
        }
        else {
            this.radius *= 1.05263158;
        }
        this.sigChange.emit();
    }
}
//# sourceMappingURL=orbitControls.js.map