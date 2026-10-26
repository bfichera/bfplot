import { MPlotViewer } from "./viewer.js";
export interface BootstrapOptions {
    target?: HTMLElement | string;
    documentUrl?: string;
    objectBaseUrl?: string;
}
export declare function bootstrap(options?: BootstrapOptions): Promise<MPlotViewer>;
