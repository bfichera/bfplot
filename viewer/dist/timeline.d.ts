import type { MPlotDocument, TimelineUpdate } from "./types.js";
type DocumentRenderer = (document: MPlotDocument) => Promise<void>;
/**
 * Owns deterministic timeline replay and its controls.
 *
 * Seeking always starts from the immutable source document. This is deliberately
 * simple: updates are semantic replacements, so replay never depends on whatever
 * frame happened to render previously.
 */
export declare class TimelinePlayer {
    private readonly renderDocument;
    private source;
    private time;
    private playing;
    private playbackRate;
    private playbackStarted;
    private playbackOrigin;
    private animationFrame;
    private controls;
    constructor(document: MPlotDocument, renderDocument: DocumentRenderer);
    get available(): boolean;
    setDocument(document: MPlotDocument): void;
    createControls(): HTMLElement | undefined;
    pause(): void;
    private button;
    private seek;
    private play;
    private step;
    private refreshControls;
}
export declare function applyTimelineUpdate(document: MPlotDocument, update: TimelineUpdate): void;
export {};
