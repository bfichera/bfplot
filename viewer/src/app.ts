import { createHttpArrayResolver, loadDocument } from "./loader.js";
import { BFPlotViewer } from "./viewer.js";

export interface BootstrapOptions {
  target?: HTMLElement | string;
  documentUrl?: string;
  objectBaseUrl?: string;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BFPlotViewer> {
  const target=typeof options.target==="string"?document.querySelector<HTMLElement>(options.target):options.target??document.querySelector<HTMLElement>("#bfplot-app");
  if(!target)throw new Error("BFPlot app target not found");
  target.setAttribute("aria-busy","true");
  try {
    const document=await loadDocument({documentUrl:options.documentUrl??"/document"});
    target.removeAttribute("aria-busy");
    return new BFPlotViewer(target,document,{arrayResolver:createHttpArrayResolver(options.objectBaseUrl??"/objects/sha256")});
  } catch(error) {
    target.removeAttribute("aria-busy"); target.classList.add("bfplot-viewer");
    const message=error instanceof Error?error.message:String(error); target.innerHTML=`<div class="bfplot-error"><strong>Unable to load plot</strong><br><span></span></div>`;
    const detail=target.querySelector("span");if(detail)detail.textContent=message;
    throw error;
  }
}

if(typeof window!=="undefined"&&typeof document!=="undefined"){
  const start=()=>void bootstrap().catch((error)=>console.error("BFPlot bootstrap failed",error));
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
}
