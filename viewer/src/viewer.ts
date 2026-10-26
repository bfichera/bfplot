import { ViewerModel } from "./model.js";
import { builtinRenderers, type ArtistRenderer, type RenderContext } from "./renderers.js";
import { createScale, formatTick, type Scale } from "./scales.js";
import { resolveTheme } from "./theme.js";
import type { Artist, ArrayResolver, Axis, MPlotDocument, MPlotSelectionEventDetail, PointSelection, ResolvedData, Theme, ThemeName, Viewport } from "./types.js";
import { numeric, pairs, SVG_NS, svg } from "./svg.js";

export interface ViewerOptions {
  theme?: ThemeName | Partial<Theme>;
  arrayResolver?: ArrayResolver;
  renderers?: Record<string, ArtistRenderer>;
  interactive?: boolean;
  toolbar?: boolean;
  liveUrl?: string;
}

interface AxisView { axis: Axis; host: HTMLElement; svg: SVGSVGElement; plot: SVGGElement; overlay: SVGGElement; readout: HTMLElement; width: number; height: number; margin: { left: number; right: number; top: number; bottom: number }; x: Scale; y: Scale; }
type Mode = "pan" | "zoom" | "select";

export class MPlotViewer extends EventTarget {
  readonly element: HTMLElement;
  readonly model: ViewerModel;
  private options: ViewerOptions;
  private theme: Theme;
  private renderers = new Map<string, ArtistRenderer>();
  private views = new Map<string, AxisView>();
  private resolvedData = new Map<string, ResolvedData>();
  private mode: Mode = "pan";
  private source?: EventSource;
  private resize?: ResizeObserver;
  private renderToken = 0;
  private fitPending: Promise<void> | undefined;

  constructor(target: HTMLElement, document: MPlotDocument, options: ViewerOptions = {}) {
    super();
    this.element = target;
    this.options = options;
    this.theme = resolveTheme(options.theme);
    this.model = new ViewerModel(document, options.arrayResolver);
    Object.entries(builtinRenderers).forEach(([type, renderer]) => this.renderers.set(type, renderer));
    Object.entries(options.renderers ?? {}).forEach(([type, renderer]) => this.renderers.set(type, renderer));
    this.element.classList.add("mplot-viewer");
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", document.title ?? "Interactive scientific plot");
    this.applyTheme();
    this.model.addEventListener("viewport", () => { void this.renderPlots(); });
    this.model.addEventListener("selection", () => { void this.renderPlots(); });
    this.model.addEventListener("change", () => { void this.render(); });
    if (typeof ResizeObserver !== "undefined") {
      this.resize = new ResizeObserver(() => { void this.renderPlots(); });
      this.resize.observe(this.element);
    }
    if (options.liveUrl) this.connectLive(options.liveUrl);
    void this.render();
  }

  registerRenderer(type: string, renderer: ArtistRenderer): this { this.renderers.set(type, renderer); void this.renderPlots(); return this; }
  unregisterRenderer(type: string): boolean { const removed = this.renderers.delete(type); if (removed) void this.renderPlots(); return removed; }
  update(document: MPlotDocument): void { this.model.setDocument(document); }

  setTheme(theme: ThemeName | Partial<Theme>): void {
    this.options.theme = theme;
    this.theme = resolveTheme(theme);
    this.applyTheme();
    void this.renderPlots();
  }

  reset(): void { void this.fitToData(); }

  destroy(): void {
    this.source?.close();
    this.resize?.disconnect();
    this.element.replaceChildren();
    this.element.classList.remove("mplot-viewer");
  }

  async render(): Promise<void> {
    const token = ++this.renderToken;
    this.views.clear();
    this.resolvedData.clear();
    this.element.replaceChildren();
    const header = document.createElement("header"); header.className = "mplot-header";
    const title = document.createElement("div"); title.className = "mplot-title"; title.textContent = this.model.document.title ?? "MPlot"; header.append(title);
    if (this.options.toolbar !== false) header.append(this.createToolbar());
    this.element.append(header);
    const figures = document.createElement("main"); figures.className = "mplot-figures"; this.element.append(figures);
    for (const figure of this.model.document.figures) {
      const figureElement = document.createElement("section"); figureElement.className = "mplot-figure"; figureElement.dataset.figureId = figure.id;
      if (figure.title) { const heading=document.createElement("div"); heading.className="mplot-figure-title"; heading.textContent=figure.title; figureElement.append(heading); }
      const axisIds = (figure.axes ?? this.model.document.axes.filter((axis) => !axis.figure_id || axis.figure_id === figure.id)).map((axis) => typeof axis === "string" ? axis : axis.id);
      for (const axisId of axisIds) {
        const axis = this.model.document.axes.find((item) => item.id === axisId); if (!axis) continue;
        const host=document.createElement("div"); host.className="mplot-axis"; host.dataset.axesId=axis.id; host.setAttribute("aria-label",axis.title??`Plot ${axis.id}`);
        const chart=svg("svg",{role:"img",viewBox:"0 0 640 360","aria-label":axis.title??"Scientific plot"});
        const plot=svg("g"), overlay=svg("g"); chart.append(plot,overlay);
        const readout=document.createElement("output");readout.className="mplot-coordinates";readout.setAttribute("aria-live","polite");readout.textContent="x — · y —";
        host.append(chart,readout); figureElement.append(host);
        this.views.set(axis.id,{axis,host,svg:chart,plot,overlay,readout,width:640,height:360,margin:{left:70,right:24,top:34,bottom:72},x:createScale(axis.xscale,this.model.viewports.get(axis.id)!.x,[70,616]),y:createScale(axis.yscale,this.model.viewports.get(axis.id)!.y,[288,34])});
        if (this.options.interactive !== false) this.bindInteractions(this.views.get(axis.id)!);
      }
      figures.append(figureElement);
    }
    if (token === this.renderToken) await this.fitToData();
  }

  private async fitToData(): Promise<void> {
    if (this.fitPending) return this.fitPending;
    this.fitPending = (async () => { await this.model.fitViewports(); await this.renderPlots(); })();
    try { await this.fitPending; } finally { this.fitPending = undefined; }
  }

  private createToolbar(): HTMLElement {
    const toolbar=document.createElement("nav"); toolbar.className="mplot-toolbar"; toolbar.setAttribute("aria-label","Plot tools");
    const actions: Array<[string,string,()=>void]> = [["Pan","pan",()=>this.setMode("pan")],["Zoom","zoom",()=>this.setMode("zoom")],["Select","select",()=>this.setMode("select")],["Reset","reset",()=>this.reset()],["SVG","svg",()=>this.downloadSVG()],["PNG","png",()=>void this.downloadPNG()]];
    for(const [label,name,action] of actions){const button=document.createElement("button");button.type="button";button.className="mplot-button";button.textContent=label;button.dataset.action=name;button.title=label;button.onclick=action;if(["pan","zoom","select"].includes(name))button.setAttribute("aria-pressed",String(this.mode===name));toolbar.append(button);}
    return toolbar;
  }

  private setMode(mode: Mode): void { this.mode=mode; this.element.querySelectorAll<HTMLElement>("[data-action]").forEach(button=>{if(["pan","zoom","select"].includes(button.dataset.action??""))button.setAttribute("aria-pressed",String(button.dataset.action===mode));}); }

  private async renderPlots(): Promise<void> {
    const token=++this.renderToken;
    for (const view of this.views.values()) {
      const rect=view.host.getBoundingClientRect(); view.width=Math.max(320,rect.width||640); view.height=Math.max(220,rect.height||360); view.svg.setAttribute("viewBox",`0 0 ${view.width} ${view.height}`);
      const viewport=this.model.viewports.get(view.axis.id)!; const right=view.width-view.margin.right,bottom=view.height-view.margin.bottom;
      view.x=createScale(view.axis.xscale,viewport.x,[view.margin.left,right]); view.y=createScale(view.axis.yscale,viewport.y,[bottom,view.margin.top]); view.plot.replaceChildren(); view.overlay.replaceChildren();
      this.drawAxes(view);
      const clipId=`mplot-clip-${safeId(view.axis.id)}`; const defs=svg("defs"),clip=svg("clipPath",{id:clipId});clip.append(svg("rect",{x:view.margin.left,y:view.margin.top,width:right-view.margin.left,height:bottom-view.margin.top}));defs.append(clip);view.plot.prepend(defs);
      const artists=this.model.document.artists.filter((artist)=>artist.axes_id===view.axis.id);
      for(const artist of artists){const group=svg("g",{"data-artist-id":artist.id,"clip-path":`url(#${clipId})`});view.plot.append(group);const renderer=this.renderers.get(artist.type);if(!renderer){this.drawUnknown(group,artist,view);continue;}try{const data=await this.model.resolveData(artist.data,artist);if(token!==this.renderToken)return;this.resolvedData.set(artist.id,data);const selected=this.selectedIndices(artist.id);await renderer({...view,group,artist,data,theme:this.theme,selected,project3d:(x,y,z)=>this.project3d(view,x,y,z)} as RenderContext);}catch(error){this.drawUnknown(group,artist,view,error instanceof Error?error.message:"render failed");}}
      this.drawHitArea(view);
    }
  }

  private drawAxes(view: AxisView): void {
    const {left,top,bottom,right}=view.margin,b=view.height-bottom,r=view.width-right;
    for(const tick of view.x.ticks()){const px=view.x(tick);view.plot.append(svg("line",{x1:px,x2:px,y1:top,y2:b,class:"mplot-grid-line"}));const text=svg("text",{x:px,y:b+17,"text-anchor":"middle",class:"mplot-tick"});text.textContent=formatTick(tick,view.axis.xscale);view.plot.append(text);}
    for(const tick of view.y.ticks()){const py=view.y(tick);view.plot.append(svg("line",{x1:left,x2:r,y1:py,y2:py,class:"mplot-grid-line"}));const text=svg("text",{x:left-8,y:py+4,"text-anchor":"end",class:"mplot-tick"});text.textContent=formatTick(tick,view.axis.yscale);view.plot.append(text);}
    view.plot.append(svg("path",{d:`M${left},${top}H${r}V${b}H${left}Z`,fill:"none",class:"mplot-axis-frame"}));
    if(view.axis.title){const t=svg("text",{x:(left+r)/2,y:18,"text-anchor":"middle",class:"mplot-axis-title"});t.textContent=view.axis.title;view.plot.append(t);}
    if(view.axis.xlabel){const t=svg("text",{x:(left+r)/2,y:b+44,"text-anchor":"middle",class:"mplot-label"});t.textContent=view.axis.xlabel;view.plot.append(t);}
    if(view.axis.ylabel){const t=svg("text",{x:14,y:(top+b)/2,"text-anchor":"middle",class:"mplot-label",transform:`rotate(-90 14 ${(top+b)/2})`});t.textContent=view.axis.ylabel;view.plot.append(t);}
  }

  private drawUnknown(group: SVGGElement, artist: Artist, view: AxisView, reason="Renderer not installed"): void { const box=svg("g",{class:"mplot-unknown"});box.append(svg("rect",{x:view.margin.left+12,y:view.margin.top+12,width:Math.min(260,view.width-120),height:44,rx:5}));const text=svg("text",{x:view.margin.left+22,y:view.margin.top+31});text.textContent=`Unknown: ${artist.type}`;const detail=svg("text",{x:view.margin.left+22,y:view.margin.top+47});detail.textContent=reason;box.append(text,detail);group.append(box); }

  private drawHitArea(view: AxisView): void { const {left,top,bottom,right}=view.margin;view.overlay.append(svg("rect",{x:left,y:top,width:view.width-right-left,height:view.height-bottom-top,class:"mplot-hit"})); }

  private bindInteractions(view: AxisView): void {
    let start: {x:number;y:number;viewport:Viewport}|undefined; let brush: SVGRectElement|undefined;
    const finish=(event:PointerEvent,cancel=false)=>{if(!start)return;const pointer=this.pointer(view,event),p=this.boundToPlot(view,pointer.x,pointer.y);if(!cancel&&this.mode==="zoom"&&Math.hypot(p.x-start.x,p.y-start.y)>4){this.model.setViewport(view.axis.id,{...start.viewport,x:[view.x.invert(Math.min(start.x,p.x)),view.x.invert(Math.max(start.x,p.x))],y:[view.y.invert(Math.max(start.y,p.y)),view.y.invert(Math.min(start.y,p.y))]});}else if(!cancel&&this.mode==="select")this.selectRect(view,start.x,start.y,p.x,p.y);start=undefined;brush?.remove();brush=undefined;};
    view.svg.addEventListener("pointerdown",event=>{const p=this.pointer(view,event);if(!this.inPlot(view,p.x,p.y))return;start={...p,viewport:structuredClone(this.model.viewports.get(view.axis.id)!)};view.svg.setPointerCapture(event.pointerId);if(this.mode==="select"||this.mode==="zoom"){brush=svg("rect",{x:p.x,y:p.y,width:0,height:0,class:`mplot-brush mplot-brush--${this.mode}`});view.overlay.append(brush);}});
    view.svg.addEventListener("pointermove",event=>{const p=this.pointer(view,event);this.updateCoordinates(view,p.x,p.y);if(!start){this.showTooltip(view,p.x,p.y);return;}if(this.mode==="pan"){const next=structuredClone(start.viewport);const dx=view.x.invert(start.x)-view.x.invert(p.x),dy=view.y.invert(start.y)-view.y.invert(p.y);next.x=[start.viewport.x[0]+dx,start.viewport.x[1]+dx];next.y=[start.viewport.y[0]+dy,start.viewport.y[1]+dy];this.model.setViewport(view.axis.id,next);}else if(brush){const bounded=this.boundToPlot(view,p.x,p.y);brush.setAttribute("x",String(Math.min(start.x,bounded.x)));brush.setAttribute("y",String(Math.min(start.y,bounded.y)));brush.setAttribute("width",String(Math.abs(bounded.x-start.x)));brush.setAttribute("height",String(Math.abs(bounded.y-start.y)));}});
    view.svg.addEventListener("pointerup",event=>finish(event));
    view.svg.addEventListener("pointercancel",event=>finish(event,true));
    view.svg.addEventListener("pointerleave",()=>{if(!start){this.clearHover(view);}});
    view.svg.addEventListener("wheel",event=>{event.preventDefault();const p=this.pointer(view,event);if(!this.inPlot(view,p.x,p.y))return;const factor=Math.exp(event.deltaY*.001);const current=this.model.viewports.get(view.axis.id)!;const cx=view.x.invert(p.x),cy=view.y.invert(p.y);this.model.setViewport(view.axis.id,{...current,x:[cx+(current.x[0]-cx)*factor,cx+(current.x[1]-cx)*factor],y:[cy+(current.y[0]-cy)*factor,cy+(current.y[1]-cy)*factor]});},{passive:false});
    view.svg.addEventListener("dblclick",()=>this.reset());
  }

  private pointer(view: AxisView,event: PointerEvent|WheelEvent): {x:number;y:number} {const rect=view.svg.getBoundingClientRect();return{x:(event.clientX-rect.left)*view.width/(rect.width||view.width),y:(event.clientY-rect.top)*view.height/(rect.height||view.height)};}
  private plotBounds(view:AxisView):{left:number;right:number;top:number;bottom:number}{return{left:view.margin.left,right:view.width-view.margin.right,top:view.margin.top,bottom:view.height-view.margin.bottom};}
  private inPlot(view:AxisView,x:number,y:number):boolean{const bounds=this.plotBounds(view);return x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom;}
  private boundToPlot(view:AxisView,x:number,y:number):{x:number;y:number}{const bounds=this.plotBounds(view);return{x:Math.max(bounds.left,Math.min(bounds.right,x)),y:Math.max(bounds.top,Math.min(bounds.bottom,y))};}
  private updateCoordinates(view:AxisView,px:number,py:number):void{if(!this.inPlot(view,px,py)){view.readout.textContent="x — · y —";return;}view.readout.textContent=`x ${formatTick(view.x.invert(px),view.axis.xscale)} · y ${formatTick(view.y.invert(py),view.axis.yscale)}`;}
  private clearHover(view:AxisView):void{view.host.querySelector<HTMLElement>(".mplot-tooltip")?.remove();view.readout.textContent="x — · y —";}

  private selectRect(view: AxisView,x0:number,y0:number,x1:number,y1:number): void {const left=Math.min(x0,x1),right=Math.max(x0,x1),top=Math.min(y0,y1),bottom=Math.max(y0,y1),points:PointSelection[]=[];for(const artist of this.model.document.artists.filter(a=>a.axes_id===view.axis.id)){const data=this.resolvedData.get(artist.id)??artist.data;const selected=pairs(data.x,data.y).filter(([x,y])=>{const px=view.x(x),py=view.y(y);return px>=left&&px<=right&&py>=top&&py<=bottom;}).map(([, ,i])=>i);if(selected.length)points.push({artistId:artist.id,indices:selected});}const id=this.model.document.selections?.[0]?.id??"selection";this.model.setSelection(id,points);const detail:MPlotSelectionEventDetail={selectionId:id,axesId:view.axis.id,points};const event=new CustomEvent<MPlotSelectionEventDetail>("mplot:selection",{detail});this.element.dispatchEvent(event);this.dispatchEvent(event);}
  private selectedIndices(artistId:string): Set<number> {const values=new Set<number>();for(const selection of this.model.selections.values())for(const point of selection)if(point.artistId===artistId)point.indices.forEach(i=>values.add(i));return values;}

  private showTooltip(view:AxisView,px:number,py:number):void {let best:{artist:Artist;index:number;x:number;y:number;distance:number}|undefined;for(const artist of this.model.document.artists.filter(a=>a.axes_id===view.axis.id)){const data=this.resolvedData.get(artist.id)??artist.data;for(const [x,y,index] of pairs(data.x,data.y)){const distance=Math.hypot(view.x(x)-px,view.y(y)-py);if(distance<18&&(!best||distance<best.distance))best={artist,index,x,y,distance};}}let tooltip=view.host.querySelector<HTMLElement>(".mplot-tooltip");if(!best){tooltip?.remove();return;}if(!tooltip){tooltip=document.createElement("div");tooltip.className="mplot-tooltip";view.host.append(tooltip);}tooltip.style.left=`${px/view.width*100}%`;tooltip.style.top=`${py/view.height*100}%`;tooltip.textContent=`${best.artist.props.label??best.artist.id} [${best.index}]  x ${formatTick(best.x,view.axis.xscale)} · y ${formatTick(best.y,view.axis.yscale)}`;}

  private project3d(view:AxisView,x:number,y:number,z:number):[number,number] {const viewport=this.model.viewports.get(view.axis.id)!;const zlim=viewport.z??[0,1],zn=(z-zlim[0])/(zlim[1]-zlim[0]||1)-.5;return[view.x(x)+zn*32,view.y(y)-zn*24];}

  exportSVG(): string {const svgs=Array.from(this.element.querySelectorAll("svg"));if(svgs.length===1)return new XMLSerializer().serializeToString(svgs[0]!);const width=Math.max(...svgs.map(s=>Number(s.viewBox.baseVal.width)||640)),heights=svgs.map(s=>Number(s.viewBox.baseVal.height)||360),root=document.createElementNS(SVG_NS,"svg");root.setAttribute("xmlns",SVG_NS);root.setAttribute("width",String(width));root.setAttribute("height",String(heights.reduce((a,b)=>a+b,0)));let y=0;svgs.forEach((source,i)=>{const group=svg("g",{transform:`translate(0 ${y})`});group.innerHTML=source.innerHTML;root.append(group);y+=heights[i]!;});return new XMLSerializer().serializeToString(root);}
  downloadSVG(filename="mplot.svg"):void {this.download(new Blob([this.exportSVG()],{type:"image/svg+xml;charset=utf-8"}),filename);}
  async exportPNG(scale=2):Promise<Blob>{const content=this.exportSVG(),blob=new Blob([content],{type:"image/svg+xml"}),url=URL.createObjectURL(blob);try{const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Unable to rasterize SVG"));image.src=url;});const canvas=document.createElement("canvas");canvas.width=image.width*scale;canvas.height=image.height*scale;const context=canvas.getContext("2d");if(!context)throw new Error("Canvas unavailable");context.scale(scale,scale);context.drawImage(image,0,0);return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("PNG encoding failed")),"image/png"));}finally{URL.revokeObjectURL(url);}}
  async downloadPNG(filename="mplot.png"):Promise<void>{this.download(await this.exportPNG(),filename);}
  private download(blob:Blob,filename:string):void {const link=document.createElement("a"),url=URL.createObjectURL(blob);link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}

  connectLive(url:string):void {this.source?.close();if(typeof EventSource==="undefined")return;this.source=new EventSource(url);const update=(event:MessageEvent)=>{try{const payload=JSON.parse(String(event.data)) as MPlotDocument|{document:MPlotDocument};this.update("document" in payload?payload.document:payload);}catch(error){this.dispatchEvent(new CustomEvent("mplot:error",{detail:error}));}};this.source.addEventListener("document",update as EventListener);this.source.onmessage=update;this.source.onerror=()=>this.dispatchEvent(new Event("mplot:disconnect"));}

  private applyTheme():void {const values:Record<string,string>={"--mplot-bg":this.theme.background,"--mplot-panel":this.theme.panel,"--mplot-fg":this.theme.foreground,"--mplot-muted":this.theme.muted,"--mplot-grid":this.theme.grid,"--mplot-accent":this.theme.accent,"--mplot-selection":this.theme.selection,"font-family":this.theme.fontFamily};for(const [key,value] of Object.entries(values))this.element.style.setProperty(key,value);}
}

const safeId=(value:string):string=>value.replace(/[^a-zA-Z0-9_-]/g,"-");
