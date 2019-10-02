import { NamedBlob } from "./utils/fileUtils.js";
export function bindDragAndDrop(element, cb) {
    element.addEventListener("drop", e => {
        e.stopPropagation();
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files) {
            const files = [];
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
//# sourceMappingURL=dragAndDrop.js.map