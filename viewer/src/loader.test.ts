import { describe, expect, it, vi } from "vitest";
import { createHttpArrayResolver, decodeArray, loadDocument } from "./loader.js";

const reference={object:`sha256:${"b".repeat(64)}` as const,dtype:"f4",shape:[2],codec:"raw"};

describe("HTTP artifact loader",()=>{
  it("decodes little-endian typed arrays and validates sizes",()=>{
    const source=new Float32Array([1.25,-3.5]);
    expect(Array.from(decodeArray(reference,new Uint8Array(source.buffer)) as Float32Array)).toEqual([1.25,-3.5]);
    expect(()=>decodeArray(reference,new Uint8Array(2))).toThrow(/byte length mismatch/i);
  });

  it("fetches objects using the Rust server route",async()=>{
    const source=new Float32Array([2,4]);
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(source.buffer,{status:200}));
    const value=await createHttpArrayResolver("/objects/sha256")(reference);
    expect(Array.from(value as Float32Array)).toEqual([2,4]);
    expect(fetcher).toHaveBeenCalledWith(`/objects/sha256/${"b".repeat(64)}`,{});
    fetcher.mockRestore();
  });

  it("loads and normalizes /document",async()=>{
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({figures:[{id:"f",axes:[]}]}),{status:200}));
    const result=await loadDocument();
    expect(result.figures[0]?.id).toBe("f");
    expect(fetcher).toHaveBeenCalledWith("/document",{});
    fetcher.mockRestore();
  });
});
