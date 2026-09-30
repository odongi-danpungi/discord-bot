const port=Number(process.env.PORT||3000);
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),4000);
try{
  const response=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:controller.signal,headers:{accept:'application/json'}});
  const body=await response.json().catch(()=>({}));
  if(response.status!==200||body?.ready!==true)throw new Error(`health status ${response.status}`);
  process.exitCode=0;
}catch(error){
  console.error(`healthcheck failed: ${error?.message||error}`);
  process.exitCode=1;
}finally{clearTimeout(timer);}
