import type { BFPlotDocument, Timeline, TimelineUpdate } from "./types.js";
type DocumentRenderer = (document: BFPlotDocument) => Promise<void>;
/**
 * Owns deterministic replay of every timeline in a document.
 *
 * Each timeline drives its own figures and has its own clock and controls. Seeking
 * always starts from the immutable source document and replays every timeline up to
 * its own time. This is deliberately simple: updates are semantic replacements, so
 * replay never depends on whatever frame happened to render previously.
 */
export declare class TimelineSet {
    private readonly renderDocument;
    private source;
    private players;
    constructor(document: BFPlotDocument, renderDocument: DocumentRenderer);
    get available(): boolean;
    setDocument(document: BFPlotDocument): void;
    /** One controls element per timeline, each tagged with the figures it drives. */
    createControls(): HTMLElement[];
    /** Show only the controls of the timeline that animates `figureId`. */
    showFigure(figureId: string | undefined): void;
    pause(): void;
    private createPlayers;
    private render;
}
/** The clock and controls of one timeline. */
export declare class TimelinePlayer {
    private readonly timeline;
    private readonly changed;
    private time;
    private playing;
    private playbackRate;
    private playbackStarted;
    private playbackOrigin;
    private animationFrame;
    private controls;
    constructor(timeline: Timeline, changed: () => Promise<void>);
    drives(figureId: string): boolean;
    setVisible(visible: boolean): void;
    /** Apply every frame up to this timeline's current time. */
    applyTo(document: BFPlotDocument): void;
    createControls(): HTMLElement;
    pause(): void;
    private button;
    private seek;
    private play;
    private step;
    private refreshControls;
}
export declare function applyTimelineUpdate(document: BFPlotDocument, update: TimelineUpdate): void;
export {};
