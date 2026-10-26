import { describe, expect, it } from "vitest";
import { normalizeArtistData, normalizeDocument } from "./normalize.js";

const ref=(shape:number[])=>({object:`sha256:${"a".repeat(64)}`,dtype:"f8",shape,codec:"zstd"});

describe("document normalization",()=>{
  it("flattens Python figures, axes, and artists",()=>{
    const result=normalizeDocument({schema_version:1,figures:[{id:"f",size_inches:[6,4],dpi:100,axes:[{id:"a",title:"Signal",bounds:[.1,.2,.8,.7],x:{label:"time",scale:"log",limits:[1,10]},y:{label:"value",scale:"linear",limits:[-2,2]},artists:[{type:"mplot.scatter",schema_version:1,id:"s",axes_id:"a",props:{color:[1,0,.5,.5]},data:{xy:ref([2,2])}}]}]}]});
    expect(result.figures[0]).toMatchObject({id:"f",axes:["a"],size:[600,400]});
    expect(result.axes[0]).toMatchObject({id:"a",figure_id:"f",xlabel:"time",xscale:"log",xlim:[1,10],position:[.1,.2,.8,.7]});
    expect(result.artists[0]?.props.color).toBe("rgba(255, 0, 128, 0.5)");
  });

  it("preserves flat axis limits, scales, dates, positions, and auxiliary colorbars from served artifacts",()=>{
    const result=normalizeDocument({figures:[{id:"f",axes:["a","c"]}],axes:[{id:"a",figure_id:"f",xlim:[-2,8],ylim:[10,20],xscale:"symlog",yscale:"log",xticks:[0,1],xticklabels:["Jan 01","Jan 02"],xdate_format:"%b %d",position:[.1,.2,.7,.7]},{id:"c",figure_id:"f",role:"colorbar",position:[.82,.2,.03,.7],colorbar:{orientation:"vertical",label:"intensity",limits:[-1,1],ticks:[-1,0,1],ticklabels:["−1","0","1"],cmap:"magma",colors:[[0,0,0,1],[1,1,1,1]]}}],artists:[]});
    expect(result.axes[0]).toMatchObject({id:"a",xlim:[-2,8],ylim:[10,20],xscale:"symlog",yscale:"log",position:[.1,.2,.7,.7],props:{xaxis:{ticks:[0,1],ticklabels:["Jan 01","Jan 02"],date_format:"%b %d"}}});
    expect(result.axes[1]).toMatchObject({id:"c",role:"colorbar",position:[.82,.2,.03,.7],colorbar:{orientation:"vertical",label:"intensity",limits:[-1,1],ticks:[-1,0,1]}});
  });

  it("adapts matrix and segmented path arrays",()=>{
    const scatter=normalizeArtistData("mplot.scatter",{xy:ref([2,2])},{xy:new Float64Array([1,2,3,4])});
    expect(scatter).toMatchObject({x:[1,3],y:[2,4]});
    const paths=normalizeArtistData("mplot.contour",{vertices:ref([5,2])},{vertices:new Float64Array([0,0,1,1,2,2,3,3,4,4]),path_lengths:new BigInt64Array([2n,3n])});
    expect(paths.paths).toEqual([[[0,0],[1,1]],[[2,2],[3,3],[4,4]]]);
  });

  it("handles empty extracted contour segments without looping",()=>{
    const contour=normalizeArtistData("mplot.contour",{segments:ref([0])},{segments:new Float64Array(0)});
    expect(contour.paths).toEqual([]);
  });

  it("reshapes extracted patch paths and applies path lengths to 3D vertices",()=>{
    const patch=normalizeArtistData("mplot.patch",{path:ref([3,2])},{path:new Float64Array([0,0,1,0,1,1]),transform:[[1,0,.25],[0,1,.5],[0,0,1]]});
    expect(patch.vertices).toEqual([[0,0],[1,0],[1,1]]);
    const surface=normalizeArtistData("mplot.surface3d",{vertices:ref([4,3]),path_lengths:ref([1]),path_codes:ref([4])},{vertices:new Float64Array([0,0,0,1,0,.5,1,1,1,0,1,.5]),path_lengths:new BigInt64Array([4n]),path_codes:new Uint8Array([1,2,2,79])});
    expect(surface.paths).toEqual([[[0,0,0],[1,0,.5],[1,1,1],[0,1,.5]]]);
    expect(surface.path_codes).toEqual([[1,2,2,79]]);
  });

  it("normalizes extracted error and cap segments",()=>{
    const result=normalizeArtistData("mplot.errorbar",{error_segments:ref([1,2,2]),cap_segments:ref([1,2,2])},{error_segments:new Float64Array([1,2,1,4]),cap_segments:new Float64Array([.9,2,1.1,2])});
    expect(result.error_paths).toEqual([[[1,2],[1,4]]]);
    expect(result.cap_paths).toEqual([[[.9,2],[1.1,2]]]);
  });

  it("adapts extracted histogram rectangles",()=>{
    const data=normalizeArtistData("mplot.histogram",{},{left:[0,2],bottom:[0,1],width:[1,1],height:[3,4]});
    expect(data.rects).toEqual([[0,0,1,3],[2,1,1,4]]);
  });
});
