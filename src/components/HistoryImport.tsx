import { IS_BROWSER_STORAGE } from "../lib/runtime-mode";
import { apiFetch } from "../lib/browser-api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { Language } from "../lib/i18n";
import type { PlatformId, ReportInput } from "../lib/report";
import "./history.css";

type Issue = { month:string; provider?:PlatformId; code:string; message:string };
type Job = {state:string;finishedAt?:number;total:number;completed:number;succeeded:number;failed:number;cached:number;inFlight:string[];availableMonths:string[];months:{month:string;state:string;full:boolean;issues:{code:string;message:string}[]}[];error?:{code:string;message:string}};
export type HistoryImportError = {code:string;message:string};
const completedKey=(job:Job)=>`${job.finishedAt ?? ""}:${job.completed}:${job.availableMonths.join(",")}`;
function validJob(value:unknown):value is Job {
  const job=value as Job|null;
  return !!job&&typeof job.state==="string"&&Array.isArray(job.months)&&Array.isArray(job.availableMonths)&&Array.isArray(job.inFlight);
}
export function HistoryImport({language,onImported,autoApply=false,onStatus,onError}:{language:Language;onImported:(inputs:ReportInput[],months:string[],issues:Issue[])=>void|Promise<void>;autoApply?:boolean;onStatus?:(job:Job)=>void;onError?:(error:HistoryImportError)=>void}) {
  const zh=language==="zh";
  const [job,setJob]=useState<Job|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [loadingResults,setLoadingResults]=useState(false);
  const active=job?.state==="running"||job?.state==="discovering";
  const callback=useRef(onImported); callback.current=onImported;
  const mounted=useRef(false);
  const applied=useRef("");
  const applyOnCompletion=useRef(false);
  const statusCallback=useRef(onStatus);statusCallback.current=onStatus;
  const errorCallback=useRef(onError);errorCallback.current=onError;
  const languageRef=useRef(language);languageRef.current=language;
  const reading=useRef(false);
  const resultController=useRef<AbortController|null>(null);
  useEffect(()=>{if(autoApply)applyOnCompletion.current=true;},[autoApply]);
  const reportError=useCallback((code:string,message:string)=>{
    if(!mounted.current)return;
    setError(message);errorCallback.current?.({code,message});
  },[]);
  const readResults=useCallback(async (current:Job) => {
    if(reading.current)return false;
    reading.current=true;
    const controller=new AbortController();resultController.current=controller;
    const timeout=setTimeout(()=>controller.abort(),15_000);
    setLoadingResults(true);
    try {
      const response=await apiFetch("/api/history/netease/reports",{signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw Error(data.error?.code??"HISTORY_RESULTS_UNAVAILABLE");
      if(!mounted.current)return false;
      if(!Array.isArray(data.inputs)||!data.inputs.length)throw Error("HISTORY_NO_RESULTS");
      const months=current.months.length?current.months.map(item=>item.month):data.months;
      if(!Array.isArray(months)||!months.length)throw Error("HISTORY_RESULTS_INVALID");
      clearTimeout(timeout);
      // The parent may still be assembling reports. Record success only after it accepts
      // the results, so a failed fetch/application can be retried for the same job.
      await callback.current(data.inputs,months,Array.isArray(data.issues)?data.issues:[]);
      if(!mounted.current)return false;
      applied.current=completedKey(current);
      applyOnCompletion.current=false;
      setError("");
      return true;
    }catch(cause){
      applyOnCompletion.current=false;
      const code=controller.signal.aborted?"HISTORY_RESULTS_TIMEOUT":cause instanceof Error?cause.message:"HISTORY_RESULTS_UNAVAILABLE";
      const isChinese=languageRef.current==="zh";
      reportError(code,code==="HISTORY_NO_RESULTS"
        ?(isChinese?"读取已结束，但尚未取得可显示的历史数据。请重试，或检查平台连接。":"Reading finished without usable history. Retry or check your platform connection.")
        :(isChinese?"暂时无法载入已读取的历史，请重试。":"Could not load saved history. Please retry."));
      return false;
    }finally{
      clearTimeout(timeout);reading.current=false;
      if(resultController.current===controller)resultController.current=null;
      if(mounted.current)setLoadingResults(false);
    }
  },[reportError]);
  useEffect(()=>{
    mounted.current=true; let stopped=false; let timer:ReturnType<typeof setTimeout>; const controller=new AbortController();
    const poll=async()=>{
      const request=new AbortController();const abort=()=>request.abort();
      controller.signal.addEventListener("abort",abort,{once:true});
      const timeout=setTimeout(abort,12_000);
      try{
        const r=await apiFetch("/api/history/netease",{signal:request.signal});
        const data=await r.json(); if(stopped)return;
        if(!r.ok)throw Error(data.error?.code??"HISTORY_STATUS_UNAVAILABLE");
        if(!validJob(data.job))throw Error("HISTORY_STATUS_INVALID");
        const next:Job=data.job; setJob(next);
        if(next)statusCallback.current?.(next);
        if(next?.state==="running"||next?.state==="discovering")applyOnCompletion.current=true;
        if(next.state==="complete"&&applyOnCompletion.current&&applied.current!==completedKey(next)){
          clearTimeout(timeout);
          await readResults(next);
        }else if(["failed","cancelled"].includes(next.state)&&applyOnCompletion.current){
          applyOnCompletion.current=false;
          reportError(next.error?.code??"HISTORY_IMPORT_INCOMPLETE",languageRef.current==="zh"?next.error?.message??"历史数据尚未读取完成，请重试。":"History import did not finish. Please retry.");
        }
      }catch(cause){
        if(!stopped&&applyOnCompletion.current){
          applyOnCompletion.current=false;
          reportError(request.signal.aborted?"HISTORY_STATUS_TIMEOUT":cause instanceof Error?cause.message:"HISTORY_STATUS_UNAVAILABLE",languageRef.current==="zh"?"暂时无法确认历史读取状态，请检查连接后重试。":"Could not confirm history import status. Check the connection and retry.");
        }
      }finally{clearTimeout(timeout);controller.signal.removeEventListener("abort",abort);}
      if(!stopped)timer=setTimeout(poll,2500);
    };
    void poll();
    return()=>{stopped=true;mounted.current=false;controller.abort();resultController.current?.abort();clearTimeout(timer);};
  },[readResults,reportError]);
  const act=async(method:"POST"|"DELETE")=>{
    setBusy(true);setError("");
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15_000);
    try{
      const r=await apiFetch("/api/history/netease",{method,headers:{"Content-Type":"application/json"},body:method==="POST"?"{}":undefined,signal:controller.signal});
      const data=await r.json();if(!r.ok)throw Error(data.error?.code??"READ_FAILED");
      if(!validJob(data.job))throw Error("HISTORY_STATUS_INVALID");
      if(mounted.current){setJob(data.job);statusCallback.current?.(data.job);if(method==="POST"){applied.current="";applyOnCompletion.current=true;}}
    }catch(e){
      const code=controller.signal.aborted?"HISTORY_START_TIMEOUT":e instanceof Error?e.message:"HISTORY_START_UNAVAILABLE";
      reportError(code,["CONNECTION_EXPIRED","NOT_CONNECTED"].includes(code)?(zh?"请先连接网易云音乐。":"Connect NetEase Cloud Music first."):(zh?"暂时无法开始读取，请稍后重试。":"Could not start reading history. Please retry."));
    }
    finally{clearTimeout(timeout);if(mounted.current)setBusy(false);}
  };
  const state=job?.state;
  return <section className="history-import" aria-label={zh?"历史数据读取":"History import"}>
    <div className="history-import-heading"><div><strong>{zh?"网易云 · 历史唱片架":"NetEase · Listening archive"}</strong><p className={active?"history-active-status":undefined} role={active?"status":undefined}>{active&&<LoaderCircle size={14} className="loading-spin" aria-hidden="true"/>}<span>{active?(job?.state==="discovering"?(zh?"正在查询历史年月目录…":"Discovering historical months…"):`${zh?"正在读取":"Reading"} ${job?.inFlight.join(" · ")||"…"}`):IS_BROWSER_STORAGE?(zh?"报告仅保存在此浏览器；关闭页面会暂停，回来后可继续读取。":"Reports stay in this browser. Closing the page pauses reading; return to continue."):(zh?"按账号历史目录逐月读取，成功结果在本机加密保存。":"Read every historical month and save successful results encrypted on this computer.")}</span></p></div>
    <button className="small-button" disabled={busy} onClick={()=>void act(active?"DELETE":"POST")}>{busy?<LoaderCircle size={15} className="loading-spin" aria-hidden="true"/>:active?<X size={15}/>:state&&state!=="idle"?<RefreshCw size={15}/>:<Download size={15}/>} {busy?(zh?"正在处理…":"Processing…"):active?(zh?"停止读取":"Stop"):(job?.failed?(zh?"继续并重试":"Continue / retry"):(zh?"读取全部历史":"Read all history"))}</button></div>
    {job&&(job.total>0||job.availableMonths.length>0)&&<><progress max={job.total||job.availableMonths.length} value={job.total?job.completed:job.availableMonths.length}/><div className="history-import-stats" role="status"><span>{job.total?`${job.completed} / ${job.total}`:job.availableMonths.length} {zh?"个月已处理":"months checked"}</span><span>{zh?`已取得 ${job.availableMonths.length} 个月 · ${job.failed} 个待重试`:`${job.availableMonths.length} retrieved · ${job.failed} to retry`}</span></div>
    {job.availableMonths.length>0&&<button className="text-button" disabled={loadingResults} onClick={()=>void readResults(job)}>{loadingResults?<LoaderCircle size={13} className="loading-spin"/>:null}{zh?"查看已读取的历史":"View retrieved history"}</button>}
    <details><summary>{zh?"各月份读取状态":"Monthly availability"}</summary><div className="history-months">{job.months.map(item=><div key={item.month} title={item.issues.map(issue=>issue.message).join(" / ")}><span>{item.month}</span><span data-state={item.state}>{["complete","cached"].includes(item.state)?(item.full?(zh?"已读取":"Loaded"):(zh?"部分数据":"Partial")):item.state==="failed"?(zh?"待重试":"Retry"):item.state==="reading"?(zh?"读取中":"Reading"):item.state==="cancelled"?(zh?"已停止":"Stopped"):(zh?"排队中":"Queued")}</span></div>)}</div></details></>}
    {error&&<div className="history-import-error" role="alert"><p className="inline-error">{error}</p>{job?.state==="complete"&&<button className="text-button" disabled={loadingResults} onClick={()=>void readResults(job)}>{loadingResults?<LoaderCircle size={13} className="loading-spin" aria-hidden="true"/>:<RefreshCw size={13}/>} {loadingResults?(zh?"正在载入…":"Loading…"):(zh?"重新载入读取结果":"Reload retrieved results")}</button>}</div>}
    {job?.error&&<p className="inline-error">{zh?job.error.message:`History import stopped (${job.error.code}).`}</p>}
  </section>;
}
