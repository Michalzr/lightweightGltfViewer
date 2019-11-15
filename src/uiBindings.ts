import { NamedBlob } from "./utils/fileUtils.js";

export function bindDragAndDrop(element: HTMLCanvasElement, cb: (files: NamedBlob[]) => void) {
    element.addEventListener("drop", e => {
        e.stopPropagation();
        e.preventDefault();

        if (e.dataTransfer && e.dataTransfer.files) {
            const files: NamedBlob[] = [];
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                files.push(new NamedBlob(e.dataTransfer.files[i], e.dataTransfer.files[i].name));
            }
            cb(files);
        }
    });

    element.addEventListener("dragover", e => {
        e.stopPropagation();
        e.preventDefault();
    });
}

export function bindResize(canvas: HTMLCanvasElement, cb: () => void): void {
    function onResize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        cb();
    }
    
    window.addEventListener("resize", onResize);
    onResize();
}

export function bindModelSelect(modelSelect: HTMLSelectElement, cb: (files: NamedBlob[]) => void): void {
    const loadSelectedModel = async () => {
        const fileResponse = await fetch(modelSelect.value);
        const file = await fileResponse.blob();
        cb([new NamedBlob(file, modelSelect.value)]);
    }
    modelSelect.addEventListener("change", loadSelectedModel);
    loadSelectedModel();
}