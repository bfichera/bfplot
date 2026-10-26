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

  it("preserves flat axis limits from served artifacts",()=>{
    const result=normalizeDocument({figures:[{id:"f",axes:["a"]}],axes:[{id:"a",figure_id:"f",xlim:[-2,8],ylim:[10,20]}],artists:[]});
    expect(result.axes[0]).toMatchObject({id:"a",xlim:[-2,8],ylim:[10,20]});
  });

  it("adapts matrix and segmented path arrays",()=>{
    const scatter=normalizeArtistData("mplot.scatter",{xy:ref([2,2])},{xy:new Float64Array([1,2,3,4])});
    expect(scatter).toMatchObject({x:[1,3],y:[2,4]});
    const paths=normalizeArtistData("mplot.contour",{vertices:ref([5,2])},{vertices:new Float64Array([0,0,1,1,2,2,3,3,4,4]),path_lengths:new BigInt64Array([2n,3n])});
    expect(paths.paths).toEqual([[[0,0],[1,1]],[[2,2],[3,3],[4,4]]]);
  });

  it("adapts extracted histogram rectangles",()=>{
    const data=normalizeArtistData("mplot.histogram",{},{left:[0,2],bottom:[0,1],width:[1,1],height:[3,4]});
    expect(data.rects).toEqual([[0,0,1,3],[2,1,1,4]]);
  });
});
