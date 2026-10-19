export interface ChangeObj {
    front: number;
    inserted: string;
    end: number;
    t: Date;
    pos?: number;
}
export declare const step: (initial: string, change: ChangeObj) => string;
export declare const compareStrings: (str: string, next: string, pos: number, t?: Date) => ChangeObj;
export declare const reconstruct: (initial: string, changes: ChangeObj[], index: number) => string;
export declare const reconstructArray: (initial: string, changes: ChangeObj[], index: number) => {
    text: string;
    isInsertRow: boolean;
    key: number;
}[];
export declare const reconstructHTML: (initial: string, changes: ChangeObj[], index: number) => string;
