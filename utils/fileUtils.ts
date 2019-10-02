export class NamedBlob {
    blob: Blob;
    name: string;

    constructor(blob: Blob, name: string) {
        this.blob = blob;
        this.name = name;
    }
}

export function preprocessUri(uri: string): string {
    let result = uri;

    // Replace backslashes with slashes
    result = result.replace("\\", "/");

    if (result.startsWith("./")) {
        // remove ./ from the beginning of a path
        result = uri.slice(2);
    }

    return result;
}