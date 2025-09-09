// customError
export class CustomError<T = unknown> extends Error {
    detail: T;
    constructor(message: string, detail: T) {
        super(message); this.detail = detail;
        this.name = 'CustomError';
    }
}
