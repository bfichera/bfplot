import { ViewerModel } from "./model.js";
import type { ArrayResolver, MPlotDocument, Theme, ThemeName } from "./types.js";
export interface ViewerOptions {
    theme?: ThemeName | Partial<Theme>;
    arrayResolver?: ArrayResolver;
    interactive?: boolean;
    toolbar?: boolean;
}
export type ExportScope = "axis" | "figure" | "artifact";
export declare class MPlotViewer extends EventTarget {
    readonly element: HTMLElement;
    readonly model: ViewerModel;
    private options;
    private theme;
    private renderers;
    private views;
    private figures;
    private resolvedData;
    private mode;
    private exportScope;
    private activeAxisId;
    private activeFigureIdValue;
    private resize?;
    private intersection?;
    private documentToken;
    private axisTokens;
    private axisRenders;
    private dirtyAxes;
    private cameras;
    private contrastLimits;
    private readonly metadataPageId;
    private readonly comparisonPageId;
    private readonly comparisonAxisId;
    private readonly comparison;
    private compareMode;
    private comparisonElement;
    private readonly timeline;
    constructor(target: HTMLElement, document: MPlotDocument, options?: ViewerOptions);
    update(document: MPlotDocument): void;
    setTheme(theme: ThemeName | Partial<Theme>): void;
    reset(axisId?: string): void;
    destroy(): void;
    render(): Promise<void>;
    private createFigure;
    private createColorbar;
    private createAxis;
    private axisPosition;
    private positionAxis;
    private mountAxis;
    private refitAxis;
    private refreshColorbar;
    private createNavigator;
    private showPage;
    private showFigure;
    private stepFigure;
    private updateNavigator;
    private pageIds;
    private createComparisonPage;
    private renderComparison;
    private closeComparison;
    private createMetadataPage;
    private metadataTree;
    private renderTimelineDocument;
    private createToolbar;
    private setMode;
    private toggleCompareMode;
    private configureComparisonTarget;
    private selectComparisonArtist;
    private refreshComparisonControls;
    private openComparison;
    private renderMounted;
    private renderAxis;
    private renderAxisNow;
    private drawAxes;
    private showsYLabel;
    private yTicks;
    private yTickWidth;
    /** X ticks that fit side by side; long text labels are rotated rather than dropped where possible. */
    private xTickLayout;
    private axisTicks;
    private dateFormat;
    private drawUnknown;
    private drawHitArea;
    private bindInteractions;
    private bind3dInteractions;
    private camera;
    private pointer;
    private plotBounds;
    private inPlot;
    private boundToPlot;
    private updateCoordinates;
    private clearHover;
    private nearestLine;
    private showTooltip;
    /** Maps data coordinates into the unit box centred on the origin. */
    private normalize3d;
    private project3d;
    private depth3d;
    private projectUnit;
    /** Draws Matplotlib-style back panes with grids, and ticks along the outer edges of the box. */
    private draw3dAxes;
    private markActiveAxis;
    exportSVG(scope?: ExportScope, id?: string): string;
    private composeFigureSVG;
    private composeFigureSVGElement;
    exportPNG(scale?: number, scope?: ExportScope, id?: string): Promise<Blob>;
    private downloadExport;
    private mountFigure;
    private activeFigureId;
    private download;
    private figureAxisIds;
    private applyTheme;
}
/** Approximate rendered width of a tick label, including simple TeX such as `$10^{3}$`. */
export declare function labelWidth(label: string): number;
/**
 * Keeps every n-th tick for the smallest n whose labels do not collide, aligned so that
 * zero stays when present. `position` and `extent` are in pixels along the axis. For evenly
 * spaced values a slightly larger stride is preferred when it gives a round step
 * (1, 2, 2.5 or 5 × 10ⁿ) and still keeps at least three labels.
 */
export declare function thinTicks<T extends {
    tick: number;
    position: number;
    extent: number;
}>(ticks: T[], gap: number): T[];
