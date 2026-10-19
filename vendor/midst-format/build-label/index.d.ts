export interface BuildIdentity {
    tag?: string;
    commit?: string;
    committedAt?: string;
}
export declare const isPreRelease: (tag: string) => boolean;
export declare const utcMinute: (iso: string) => string | undefined;
export declare const buildLabel: (identity: BuildIdentity) => string;
