import test from "node:test";
import assert from "node:assert/strict";
import { buildMusicPersona } from "./music-persona.ts";
import { buildReport, type ReportInput } from "./report.ts";

const period = { start:"2026-10-01",end:"2026-10-31",timeZone:"Asia/Shanghai" };
function report(genres:string[][], count=20) {
  const input:ReportInput={mode:"live",period,platforms:[{id:"netease",period,listenSeconds:null,durationKind:"unknown",coverageComplete:true,rankingPeriod:period,countKind:"plays",countDefinition:"full-play",rankCoverage:"top",tracks:genres.map((tags,i)=>({id:String(i),title:`Song ${i}`,artist:"Artist",count,genres:tags}))}]};
  return buildReport(input);
}
test("portrait waits for verified eligible genre samples",()=>{
  assert.equal(buildMusicPersona(report([[]])).kind,"waiting");
  assert.equal(buildMusicPersona(report([["Pop"]],10)).kind,"waiting");
});
test("a changed selection produces a different data-grounded listening portrait",()=>{
  const replay=buildMusicPersona(report([["Pop"]],120));
  assert.equal(replay.kind,"replay");assert.match(replay.evidence.zh,/120/);
  assert.equal(buildMusicPersona(report([["Classical"]])).kind,"quiet");
  assert.equal(buildMusicPersona(report([["Electronic"]])).kind,"rhythm");
  const diverse=buildMusicPersona(report([["Pop"],["Rock"],["Classical"],["Jazz"],["Electronic"]]));
  assert.equal(diverse.kind,"explorer");assert.match(diverse.evidence.en,/5 genres/);
});
