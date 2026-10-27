import { decompress } from "fzstd";
import { normalizeDocument } from "./normalize.js";
import type { ArrayReference, ArrayResolver, BFPlotDocument } from "./types.js";

export interface LoadOptions extends RequestInit { documentUrl?: string; objectBaseUrl?: string; }

const dtypePattern = /^(?:[<>=|])?([biuf])(1|2|4|8)$/;

export function decodeArray(reference: ArrayReference, stored: Uint8Array): ArrayBufferView {
  if (reference.codec && reference.codec !== "zstd" && reference.codec !== "none" && reference.codec !== "raw") throw new Error(`Unsupported array codec: ${reference.codec}`);
  const bytes = reference.codec === "zstd" ? decompress(stored) : stored;
  const match = dtypePattern.exec(reference.dtype);
  if (!match) throw new Error(`Unsupported array dtype: ${reference.dtype}`);
  const kind=match[1]!,size=Number(match[2]),count=reference.shape.reduce((total,value)=>total*value,1),expected=count*size;
  if (!reference.shape.every((value)=>Number.isSafeInteger(value)&&value>=0)) throw new Error("Invalid array shape");
  if (bytes.byteLength !== expected) throw new Error(`Array byte length mismatch: expected ${expected}, received ${bytes.byteLength}`);
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength), offset=0;
  if(kind==="f"&&size===8)return new Float64Array(buffer,offset,count);
  if(kind==="f"&&size===4)return new Float32Array(buffer,offset,count);
  if(kind==="i"&&size===8)return typeof BigInt64Array!=="undefined"?new BigInt64Array(buffer,offset,count):decodeBigIntegers(bytes,true);
  if(kind==="u"&&size===8)return typeof BigUint64Array!=="undefined"?new BigUint64Array(buffer,offset,count):decodeBigIntegers(bytes,false);
  if(kind==="i"&&size===4)return new Int32Array(buffer,offset,count);
  if(kind==="u"&&size===4)return new Uint32Array(buffer,offset,count);
  if(kind==="i"&&size===2)return new Int16Array(buffer,offset,count);
  if(kind==="u"&&size===2)return new Uint16Array(buffer,offset,count);
  if(kind==="i"&&size===1)return new Int8Array(buffer,offset,count);
  if((kind==="u"||kind==="b")&&size===1)return new Uint8Array(buffer,offset,count);
  throw new Error(`Unsupported array dtype: ${reference.dtype}`);
}

function decodeBigIntegers(bytes:Uint8Array,signed:boolean):Float64Array { const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=new Float64Array(bytes.byteLength/8);for(let i=0;i<result.length;i++){const lo=view.getUint32(i*8,true),hi=signed?view.getInt32(i*8+4,true):view.getUint32(i*8+4,true);result[i]=hi*4294967296+lo;}return result; }

export function createHttpArrayResolver(objectBaseUrl="/objects/sha256", init: RequestInit = {}): ArrayResolver {
  const base=objectBaseUrl.replace(/\/$/,"");
  return async (reference) => {
    const digest=reference.object.slice("sha256:".length);
    if(!/^[a-fA-F0-9]{64}$/.test(digest))throw new Error("Invalid SHA-256 object identifier");
    const response=await fetch(`${base}/${digest}`,init);
    if(!response.ok)throw new Error(`Object fetch failed (${response.status}): ${reference.object}`);
    return decodeArray(reference,new Uint8Array(await response.arrayBuffer()));
  };
}

export async function loadDocument(options: LoadOptions = {}): Promise<BFPlotDocument> {
  const {documentUrl="/document",objectBaseUrl:_,...init}=options;
  const response=await fetch(documentUrl,init);
  if(!response.ok)throw new Error(`Document fetch failed (${response.status})`);
  return normalizeDocument(await response.json());
}
