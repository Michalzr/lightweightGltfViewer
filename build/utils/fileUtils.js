export class NamedBlob {
    constructor(blob, name) {
        this.blob = blob;
        this.name = name;
    }
}
export function preprocessUri(uri) {
    let result = uri;
    result = result.replace("\\", "/");
    if (result.startsWith("./")) {
        result = uri.slice(2);
    }
    return result;
}
//# sourceMappingURL=fileUtils.js.map